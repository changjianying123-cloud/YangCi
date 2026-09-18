import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db/pool';
import { CardDTO, CardStatus, MoodType, UserCardRow, UserRow } from '../types';
import {
  buildAudioUrl,
  computeCardStatus,
  canFeedNow,
  nextFeedSchedule,
  getWindowInfo,
  getRemedialInfo,
  getLv1Info,
  getFeedCoinReward,
  isHungryNeedCoins,
  canAffordRecover,
  canPlayCard,
} from '../utils/cardStatus';
import { cleanMeaning, POS_PREFIX_RE } from '../utils/meaning';
import { countMnemonics } from './mnemonicService';
import { getUserFeedRepeat } from './repeatSettings';

async function getUserCoins(userId: number): Promise<number> {
  const [rows] = await pool.execute<UserRow[]>(
    'SELECT coins FROM users WHERE id = ?',
    [userId]
  );
  return rows[0]?.coins ?? 0;
}

function toCardDTO(row: UserCardRow, userCoins: number = 0, feedRepeat?: number): CardDTO {
  // 用户自定义喂养重复次数；不传则用全局默认
  const reqFeeds = Math.max(1, feedRepeat || config.card.feedSpellCount || 3);
  const now = Date.now();
  const isEgg = row.is_egg === 1;
  const status = computeCardStatus(
    row.level, row.feed_deadline, row.feed_window_end,
    row.hunger_start_at, row.downgrade_count, isEgg, now
  );

  const windowInfo = getWindowInfo(row.feed_deadline, row.feed_window_end, now);
  const remedialInfo = getRemedialInfo(row.remedial_feed_at ?? null, now);
  const lv1Info = getLv1Info(row.level, row.feed_spell_count || 0);

  // 是否可以喂养（含补救窗口）
  const canFeed = canFeedNow(row.level, row.feed_deadline, row.feed_window_end, isEgg, row.remedial_feed_at ?? null, now);
  // 是否可以玩耍（饥饿/蛋 都不行）
  const canPlay = canPlayCard(row.feed_deadline, row.feed_window_end, row.hunger_start_at ?? null, isEgg, now);

  // 心情：玩耍累计的 mood_score 为准；喂养拼写错过叠一层 sad；饿肚子也 sad。
  // 优先级：饥饿 > 拼写错过 > mood_score
  // （饥饿只叠加在展示层，不写库；喂饱/吃鱼恢复后自然回到 mood_score 的真实档位）
  // 注：档位统一走 moodOf()，避免与 playCard/getPlayQuestion 用不同阈值导致
  // 同一张卡「列表 🙂 / 玩耍接口 none」自相矛盾。
  const moodScore = row.mood_score || 0;
  let mood: MoodType = moodOf(moodScore);
  if (row.had_wrong_attempt === 1) mood = 'sad';
  const isStarving = !isEgg && !canPlay;
  if (isStarving) mood = 'sad';

  return {
    id: row.id,
    wordId: row.word_id,
    word: row.word || '',
    meaning: row.meaning || '',
    phonetic: row.phonetic || null,
    audioUrl: buildAudioUrl(row.word || '', row.audio_url),
    bookCode: row.book_code || '',
    bookName: row.book_name || '',
    level: row.level,
    feedDeadline: row.feed_deadline,
    feedWindowEnd: row.feed_window_end,
    lastFeedAt: row.last_feed_at,
    downgradeCount: row.downgrade_count,
    isEgg,
    status,
    canFeed,
    canPlay,
    feedSpellCount: Math.max(0, Math.min(row.feed_spell_count || 0, reqFeeds)),
    feedSpellRequired: reqFeeds,
    // 还剩几次拼写（倒着数：3 → 2 → 1）
    feedSpellRemaining: Math.max(0, reqFeeds - (row.feed_spell_count || 0)),
    nextFeedIn: remedialInfo.hasRemedial ? remedialInfo.humanReadable : windowInfo.humanReadable,
    mood,
    moodScore,
    playCount: row.play_count || 0,
    playCorrectCount: row.play_correct_count || 0,
    hasRemedial: remedialInfo.hasRemedial && !remedialInfo.canFeedRemedial,
    remedialFeedAt: row.remedial_feed_at ?? null,
    isLv1: lv1Info.isLv1,
    lv1FeedProgress: lv1Info.progress,
    hasRemedialWindow: remedialInfo.canFeedRemedial,
    // 金币系统
    coins: userCoins,
    isHungry: status === 'hungry',
    canRecoverFromHunger: !canFeed && status === 'hungry' && canAffordRecover(userCoins),
    feedCoinReward: canFeed ? getFeedCoinReward(row.level) : 0,
  };
}

/**
 * 饥饿→降级检测及执行
 */
async function processHungerDowngrade(rows: UserCardRow[], now: number) {
  for (const row of rows) {
    if (row.is_egg || row.level <= 0 || row.abandoned) continue;

    // 正常窗口或补救窗口内 → 清除饥饿标记
    const inNormalWindow = now >= row.feed_deadline && now < row.feed_window_end;
    const inRemedial = row.remedial_feed_at && now >= row.remedial_feed_at && now < row.remedial_feed_at + config.card.hungerWindowMs;

    if (inNormalWindow || inRemedial) {
      if (row.hunger_start_at !== null) {
        await pool.execute('UPDATE user_cards SET hunger_start_at = NULL WHERE id = ?', [row.id]);
        row.hunger_start_at = null;
      }
      continue;
    }

    // 超过补救窗口 → 清除补救标记
    if (row.remedial_feed_at && now >= row.remedial_feed_at + config.card.hungerWindowMs) {
      await pool.execute('UPDATE user_cards SET remedial_feed_at = NULL WHERE id = ?', [row.id]);
      row.remedial_feed_at = null;
    }

    // 超过正常窗口 → 饥饿
    if (now >= row.feed_window_end) {
      if (row.hunger_start_at === null) {
        await pool.execute('UPDATE user_cards SET hunger_start_at = ? WHERE id = ?', [now, row.id]);
        row.hunger_start_at = now;
        continue;
      }

      // 饥饿超过阈值（2天）→ 退化成单词蛋（需重新孵化）
      // 注：曾经这里还有一层「降级」逻辑（饥饿1h → level-1 + 立即开新喂养窗口），
      // 已移除：降级会把 hunger_start_at 清掉并马上给新窗口，导致「饥饿」状态
      // 一闪而过（用户打开 App 就消失），既让「饥饿不能玩耍」形同虚设，
      // 又和「2天变蛋」职责重叠。现在饥饿 → 持续可见 → 满 2 天变蛋。
      if (now >= row.hunger_start_at + config.card.eggThresholdMs) {
        await pool.execute(
          `UPDATE user_cards
           SET is_egg = 1, level = 0, feed_deadline = 0, feed_window_end = 0,
               hunger_start_at = NULL, feed_spell_count = 0,
               had_wrong_attempt = 0, remedial_feed_at = NULL, mood_score = 0
           WHERE id = ?`,
          [row.id]
        );
        row.is_egg = 1;
        row.level = 0;
        row.feed_deadline = 0;
        row.feed_window_end = 0;
        row.hunger_start_at = null;
        row.feed_spell_count = 0;
        row.had_wrong_attempt = 0;
        row.remedial_feed_at = null;
        row.mood_score = 0;
        continue;
      }
    }
  }
}

export async function listUserCards(userId: number): Promise<CardDTO[]> {
  const now = Date.now();
  const [rows] = await pool.execute<UserCardRow[]>(
    `SELECT uc.*, w.word, w.meaning, w.phonetic, w.audio_url, b.book_code, b.book_name
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     JOIN books b ON b.id = w.book_id
     WHERE uc.user_id = ? AND (uc.abandoned IS NULL OR uc.abandoned = 0)
     ORDER BY
       CASE
         WHEN uc.is_egg = 1 THEN 3
         WHEN uc.feed_deadline <= ? AND ? < uc.feed_window_end THEN 0
         WHEN uc.hunger_start_at IS NOT NULL THEN 1
         ELSE 2
       END,
       uc.feed_deadline ASC`,
    [userId, now, now]
  );
  await processHungerDowngrade(rows, now);
  const userCoins = await getUserCoins(userId);
  const feedRepeat = await getUserFeedRepeat(userId);
  return rows.map((r) => toCardDTO(r, userCoins, feedRepeat));
}

export async function getCardDetail(userId: number, cardId: number): Promise<CardDTO | null> {
  const [rows] = await pool.execute<UserCardRow[]>(
    `SELECT uc.*, w.word, w.meaning, w.phonetic, w.audio_url, b.book_code, b.book_name
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     JOIN books b ON b.id = w.book_id
     WHERE uc.id = ? AND uc.user_id = ? AND (uc.abandoned IS NULL OR uc.abandoned = 0)`,
    [cardId, userId]
  );
  if (!rows[0]) return null;
  const userCoins = await getUserCoins(userId);
  const feedRepeat = await getUserFeedRepeat(userId);
  const dto = toCardDTO(rows[0], userCoins, feedRepeat);
  // 喂养页要显示「查看助记」入口，这里补上助记条数（列表接口不带，避免 N+1）
  (dto as CardDTO & { mnemonicCount?: number }).mnemonicCount = await countMnemonics(rows[0].word_id);
  return dto;
}

/**
 * 获取升级所需喂养次数
 * 注：已废弃——次数统一用 config.card.feedSpellCount（3），
 * 健康喂养与拼错补考一致，避免 required 中途跳变。保留仅作历史参考。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getRequiredFeedsForLevel(_level: number): number {
  return config.card.feedSpellCount || 3;
}

export async function feedCard(userId: number, cardId: number, spellCorrect: boolean) {
  const now = Date.now();

  const [rows] = await pool.execute<UserCardRow[]>(
    `SELECT uc.* FROM user_cards uc WHERE uc.id = ? AND uc.user_id = ?`,
    [cardId, userId]
  );
  if (!rows[0]) throw new Error('卡牌不存在');
  const row = rows[0];

  if (row.is_egg) throw new Error('单词蛋需要孵化，不能喂养');
  if (row.abandoned) throw new Error('该卡牌已被遗弃');

  // 获取用户当前金币
  const [userRows] = await pool.execute<UserRow[]>(
    'SELECT coins FROM users WHERE id = ?',
    [userId]
  );
  const userCoins = userRows[0]?.coins ?? 0;

  // 检查是否在可喂养窗口内
  const inNormalWindow = now >= row.feed_deadline && now < row.feed_window_end;
  const remedialStart = row.remedial_feed_at || 0;
  const inRemedialWindow = row.remedial_feed_at && now >= remedialStart && now < remedialStart + config.card.hungerWindowMs;

  // 判断当前状态：是否饥饿（需要扣钱恢复）
  const isHungryStatus = row.hunger_start_at !== null;
  // 饥饿状态（且不在喂养窗口内）不允许直接喂养，必须先调 recoverHunger
  const feedingInHunger = false;

  // 本轮喂养的拼写次数要求：健康喂养与「拼错后补考」统一；
  // 次数可由用户在「我的」里自定义（NULL 则用全局默认），
  // 避免中途 required 跳变导致前端进度出现 1→2→3 这种反过来的显示
  const requiredFeeds = await getUserFeedRepeat(userId);
  // 已拼对次数（拼错会归零，所以这里就是本轮进度）
  const alreadyCorrect = Math.max(0, Math.min(row.feed_spell_count || 0, requiredFeeds));

  // 饥饿状态下不能直接喂养，必须先调 recoverHunger 恢复（恢复不计拼写进度）
  if (isHungryStatus && !inNormalWindow && !inRemedialWindow) {
    throw new Error('单词饥饿中，需要先消耗10金币恢复后才能喂养');
  }

  if (!inNormalWindow && !inRemedialWindow && !feedingInHunger) {
    throw new Error('现在不是喂养时间');
  }

  // ── 拼写错误 ──
  if (!spellCorrect) {
    // 扣对应等级金币
    const penaltyCoin = getFeedCoinReward(row.level);
    if (penaltyCoin > 0) {
      await pool.execute(
        'UPDATE users SET coins = GREATEST(coins - ?, 0) WHERE id = ?',
        [penaltyCoin, userId]
      );
    }

    // 重置本轮拼写进度（feed_spell_count 归零），并标记本轮出现过拼写错误
    await pool.execute(
      'UPDATE user_cards SET feed_spell_count = 0, had_wrong_attempt = 1 WHERE id = ?',
      [cardId]
    );
    return {
      done: false,
      spellCorrect: false,
      mood: 'sad' as MoodType,
      moodEmoji: '😢',
      count: 0,
      required: requiredFeeds,
      remaining: requiredFeeds,
      level: row.level,
      hadWrong: true,
      coinPenalty: penaltyCoin,
      message: penaltyCoin > 0
        ? `拼写错误，扣除 ${penaltyCoin} 💰，需要重新拼写 ${requiredFeeds} 次才能喂养成功 😢`
        : `拼写错误，需要重新拼写 ${requiredFeeds} 次才能喂养成功 😢`,
    };
  }

  // ── 拼写正确 ──
  const currentCount = alreadyCorrect + 1;
  const hadWrong = row.had_wrong_attempt === 1;

  // 本轮是否有补救窗口，且本次喂养是否在补救窗口中
  const feedingInRemedialWindow = inRemedialWindow && row.remedial_feed_at !== null;
  // 是否在饥饿恢复后喂养（饥饿状态不获得金币）
  const feedingAfterHungerRecover = false;
  const isHealthyFeed = !isHungryStatus && (inNormalWindow || inRemedialWindow);

  // 🌟 金币奖励：健康状态喂养成功获得等级对应金币
  let coinReward = 0;
  if (isHealthyFeed) {
    coinReward = getFeedCoinReward(row.level);
    await pool.execute(
      'UPDATE users SET coins = coins + ? WHERE id = ?',
      [coinReward, userId]
    );
  }

  if (currentCount >= requiredFeeds) {
    // ⭐ 达到升级条件
    const sd = nextFeedSchedule(row.level, currentCount, now);

    // 如果本轮有错误但不是在补救窗口中喂养的，安排2小时后补救
    let remedialFeedAt: number | null = null;
    if (hadWrong && !feedingInRemedialWindow) {
      remedialFeedAt = now + config.card.remedialFeedDelayMs;
    }

    await pool.execute(
      `UPDATE user_cards
       SET level = ?, feed_deadline = ?, feed_window_end = ?,
           last_feed_at = ?, hunger_start_at = NULL,
           downgrade_count = 0, is_egg = 0, feed_spell_count = 0,
           had_wrong_attempt = 0, remedial_feed_at = ?
       WHERE id = ?`,
      [sd.level, sd.feedDeadline, sd.feedWindowEnd, now, remedialFeedAt, cardId]
    );

    await pool.execute<ResultSetHeader>(
      'INSERT INTO feed_logs (user_id, card_id, spell_correct) VALUES (?, ?, ?)',
      [userId, cardId, 1]
    );

    const mood: MoodType = hadWrong && !feedingInRemedialWindow ? 'happy' : 'happy';
    const moodEmoji = mood === 'happy' ? (hadWrong ? '😆' : '😊') : '😊';

    const result: any = {
      done: true,
      spellCorrect: true,
      mood,
      moodEmoji,
      count: currentCount,
      required: requiredFeeds,
      remaining: 0,
      level: sd.level,
      feedDeadline: sd.feedDeadline,
      feedWindowEnd: sd.feedWindowEnd,
      status: 'normal' as CardStatus,
      nextFeedIn: getWindowInfo(sd.feedDeadline, sd.feedWindowEnd, now).humanReadable,
      hadWrong,
      hasRemedial: !feedingInRemedialWindow && hadWrong,
      coinReward,
      message: hadWrong
        ? `拼写正确！${moodEmoji} 但之前拼写错过，需在2小时后额外补救喂养一次`
        : `拼写正确！${moodEmoji} 喂养成功！`,
    };

    if (coinReward > 0) {
      result.message += ` 获得 ${coinReward} 🪙`;
    } else if (feedingAfterHungerRecover) {
      result.message += '（饥饿状态喂养无金币奖励）';
    }

    return result;
  } else {
    // 本轮还没拼够次数：只推进 feed_spell_count。
    // ⚠️ 这里不能清 had_wrong_attempt / remedial_feed_at（那是整轮完成时才清的），
    //    否则第二次进函数时 required 会跳变，前端进度就会变成 1→2→3
    await pool.execute(
      `UPDATE user_cards
       SET feed_spell_count = ?
       WHERE id = ?`,
      [currentCount, cardId]
    );

    const remaining = Math.max(0, requiredFeeds - currentCount);
    return {
      done: false,
      spellCorrect: true,
      mood: 'happy' as MoodType,
      moodEmoji: '😊',
      count: currentCount,
      required: requiredFeeds,
      remaining,
      level: row.level,
      coinReward,
      hadWrong,
      message: `拼写正确！还�?${remaining} 次` + (coinReward > 0 ? ` 获得 ${coinReward} 🪙` : ''),
    };
  }
}

export async function getPendingFeedCards(userId: number) {
  const cards = await listUserCards(userId);
  return cards.filter((c) => c.canFeed);
}

/**
 * 恢复饥饿状态（只恢复，不算一次拼写正确）
 * - 消耗 recoverCost 金币
 * - 清 hunger_start_at / downgrade_count，并开启一个可喂养窗口
 * - ⚠️ 不动 feed_spell_count：恢复只是把「喂养机会」还给你，
 *   拼写进度必须靠真正拼对来推进。
 */
export async function recoverHunger(userId: number, cardId: number) {
  const now = Date.now();

  const [rows] = await pool.execute<UserCardRow[]>(
    'SELECT * FROM user_cards WHERE id = ? AND user_id = ?',
    [cardId, userId]
  );
  if (!rows[0]) throw new Error('卡牌不存在');
  const row = rows[0];

  if (row.is_egg) throw new Error('单词蛋需要孵化，不能恢复喂养');
  if (row.abandoned) throw new Error('该卡牌已被遗弃');

  const isHungryStatus = row.hunger_start_at !== null;
  if (!isHungryStatus) throw new Error('该单词当前不处于饥饿状态，无需恢复');

  const userCoins = await getUserCoins(userId);
  if (userCoins < config.coins.recoverCost) {
    throw new Error(`金币不足，恢复需消耗 ${config.coins.recoverCost} 金币`);
  }

  await pool.execute('UPDATE users SET coins = coins - ? WHERE id = ?', [
    config.coins.recoverCost,
    userId,
  ]);

  // 只恢复状态：立即开启喂养窗口，拼写计数保持原样
  await pool.execute(
    `UPDATE user_cards
     SET feed_deadline = ?, feed_window_end = ?,
         hunger_start_at = NULL, downgrade_count = 0
     WHERE id = ?`,
    [now, now + config.card.hungerWindowMs, cardId]
  );

  const required = await getUserFeedRepeat(userId);
  const alreadyCorrect = Math.max(0, Math.min(row.feed_spell_count || 0, required));

  const card = await getCardDetail(userId, cardId);
  return {
    recovered: true,
    card,
    coinsSpent: config.coins.recoverCost,
    coins: userCoins - config.coins.recoverCost,
    // 拼写进度：恢复不会推进它，所以如实回传当前进度
    count: alreadyCorrect,
    required,
    remaining: Math.max(0, required - alreadyCorrect),
  };
}

export async function getCardCount(userId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS count FROM user_cards WHERE user_id = ? AND (abandoned IS NULL OR abandoned = 0)',
    [userId]
  );
  return Number(rows[0].count) || 0;
}

export async function hatchEgg(userId: number, cardId: number): Promise<CardDTO> {
  const card = await getCardDetail(userId, cardId);
  if (!card) throw new Error('卡牌不存在');
  if (!card.isEgg) throw new Error('这不是单词蛋');

  const now = Date.now();
  const sd = nextFeedSchedule(0, 0, now);

  await pool.execute(
    `UPDATE user_cards
     SET level = ?, feed_deadline = ?, feed_window_end = ?,
         last_feed_at = ?, hunger_start_at = NULL, downgrade_count = 0,
         is_egg = 0, feed_spell_count = 0, had_wrong_attempt = 0, remedial_feed_at = NULL
     WHERE id = ? AND user_id = ?`,
    [sd.level, sd.feedDeadline, sd.feedWindowEnd, now, cardId, userId]
  );

  return getCardDetail(userId, cardId) as Promise<CardDTO>;
}

/**
 * 遗弃卡牌
 */
export async function abandonCard(userId: number, cardId: number): Promise<void> {
  const [rows] = await pool.execute<UserCardRow[]>(
    'SELECT id FROM user_cards WHERE id = ? AND user_id = ? AND (abandoned IS NULL OR abandoned = 0)',
    [cardId, userId]
  );
  if (!rows[0]) throw new Error('卡牌不存在或已被遗弃');

  await pool.execute(
    'UPDATE user_cards SET abandoned = 1, abandoned_at = ? WHERE id = ?',
    [Date.now(), cardId]
  );
}

// ===== 玩耍两种玩法：pick(选词四选一) / translate(看英文打中文) =====

/** 玩法类型 */
export type PlayMode = 'pick' | 'translate';

/**
 * 把清洗后的释义拆成可接受的答案集合。
 * 例：「装饰，装点」→ ['装饰','装点']；「（押韵的）儿歌」→ ['儿歌']
 * 英文释义里带括号补充/词性残留的，去括号后也当候选。
 */
export function acceptedAnswers(meaning: unknown): string[] {
  const cleaned = cleanMeaning(meaning, 12);
  if (!cleaned) return [];
  const out = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (t) out.add(t);
  };
  push(cleaned);
  // 按中文/英文逗号、顿号、分号拆义项
  for (const part of cleaned.split(/[，,、；;]/)) {
    push(part);
    // 去掉「（补充说明）」后剩下的主干也算一个答案
    const noParen = part.replace(/[（(][^）)]*[）)]/g, '').trim();
    push(noParen);
  }
  return [...out].filter(Boolean);
}

/**
 * 列出一个单词的多个义项（用于答对后展示「其它意思」）。
 * 与 cleanMeaning 不同：cleanMeaning 只取第一个义项（用于四选一选项），
 * 这里要拿到全部义项，但每个义项本身限长。
 * 策略：先用「；;」切分不同义项组（词义差别大），每个组内限长；
 *       若无分号（只有一个组），则回退到按「，,、」切同义词。
 * 例：「adj. 突然的，意外的；粗鲁的，唐突的；险峻的，陡峭的」
 *     → ['突然的，意外的','粗鲁的，唐突的','险峻的，陡峭的']
 */
export function sensesOf(meaning: unknown, maxLen = 16): string[] {
  if (meaning === null || meaning === undefined) return [];
  let s = String(meaning).trim();
  if (!s) return [];

  // 去词性前缀（可叠加）
  let prev = '';
  let guard = 0;
  while (prev !== s && guard++ < 5) {
    prev = s;
    s = s.replace(POS_PREFIX_RE, '');
  }
  // 去 <...> 语域标注
  s = s.replace(/<[^>]*>/g, '').trim();
  // 去开头的括号说明
  const parenHead = s.match(/^[（(][^）)]*[）)]\s*(.+)$/);
  if (parenHead && parenHead[1]) s = parenHead[1].trim();

  // 分号切不同的义项组；没分号则说明整串是一个义项 → 按逗号拆同义词
  let groups = s.split(/[；;]/).map((x) => x.trim()).filter(Boolean);
  if (groups.length <= 1) {
    groups = s.split(/[，,、]/).map((x) => x.trim()).filter(Boolean);
  }

  const out: string[] = [];
  for (let g of groups) {
    // 词性前缀可能出现在中段（如「破裂；断裂；v. 破裂」），逐个剥
    let p = '';
    let gg = 0;
    while (p !== g && gg++ < 5) { p = g; g = g.replace(POS_PREFIX_RE, ''); }
    // 每个义项组限长（过长按逗号再切、仍长则硬截断）
    let one = g;
    if (one.length > maxLen) {
      const sub = one.split(/[，,、]/).map((x) => x.trim()).filter(Boolean);
      one = sub[0] || one;
    }
    if (one.length > maxLen) one = one.slice(0, maxLen);
    one = one.replace(/^[，,、；;。.：:\s]+/, '').replace(/[，,、；;。.：:]+$/, '').trim();
    // 截断可能留下未闭合的括号（如「从事金融活动（finance 的」）→ 丢弃未闭合尾部
    one = one.replace(/[（(][^）)]*$/, '').trim();
    one = one.replace(/[，,、；;。.：:]+$/, '').trim();
    const noParen = one.replace(/[（(][^）)]*[）)]/g, '').trim();
    let val = noParen || one;
    // 去掉只剩标点/括号的垃圾项（如截断后只剩「（」）
    val = val.replace(/^[（()）\s]+$/, '').trim();
    if (!val || out.includes(val)) continue;
    out.push(val);
    if (out.length >= 6) break; // 词义太多时只展示前几个
  }
  return out.length ? out : [cleanMeaning(meaning, maxLen)];
}

/** 用户输入归一化：去空白、去标点、全角转半角常见项、小写 */
export function normalizeAnswer(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '')
    // 去掉常见中英文标点与括号
    .replace(/[，,。.、；;：:！!？?“”"'‘’（）()《》<>【】\[\]~·-]/g, '');
}

/**
 * 英译汉判分：只要用户输入命中任意一个义项就算对。
 * - 完全相等
 * - 或用户输入包含某个义项（允许“装饰用的”这类多打了字）
 * - 或某个义项包含用户输入（用户只记得半截，如「很」对「很大的」）—— 该条需输入>=2字防止蒙对
 */
export function judgeTranslation(input: unknown, meaning: unknown): boolean {
  const got = normalizeAnswer(input);
  if (!got) return false;
  for (const ans of acceptedAnswers(meaning)) {
    const want = normalizeAnswer(ans);
    if (!want) continue;
    if (got === want) return true;
    if (got.length >= 2 && got.includes(want)) return true;
    if (want.length >= 2 && got.length >= 2 && want.includes(got)) return true;
  }
  return false;
}

/** 根据 mood_score 算心情档位 */
function moodOf(score: number): MoodType {
  if (score >= config.play.scoreHappy) return 'happy';
  if (score <= config.play.scoreSad) return 'sad';
  return 'none';
}

/** 取该卡（校验归属 + 未遗弃） */
async function loadOwnedCard(userId: number, cardId: number): Promise<UserCardRow | null> {
  const [rows] = await pool.execute<UserCardRow[]>(
    `SELECT uc.*, w.word, w.meaning, w.phonetic, w.audio_url, b.book_code, b.book_name
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     JOIN books b ON b.id = w.book_id
     WHERE uc.id = ? AND uc.user_id = ? AND (uc.abandoned IS NULL OR uc.abandoned = 0)`,
    [cardId, userId]
  );
  return rows[0] || null;
}

/**
 * 校验卡牌当前是否可玩耍。
 * 不可玩耍的情况：
 *  - 单词蛋：需先孵化
 *  - 饥饿 / 降级：需先喂养（或花金币恢复）
 */
function assertPlayable(card: UserCardRow): void {
  const now = Date.now();
  if (card.is_egg === 1) throw new Error('单词蛋需要先孵化才能玩耍');
  if (!canPlayCard(card.feed_deadline, card.feed_window_end, card.hunger_start_at ?? null, card.is_egg === 1, now)) {
    throw new Error('单词饿啦，先喂养（或花金币恢复）才能玩耍哦 🍼');
  }
}

/**
 * 随机挑一张可玩耍的卡（排除当前的 cardId）。
 * “继续玩耍”换一个单词，但不能把用户自己带上别的卡。
 * ⚠️ 饥饿 / 降级 / 蛋 的卡都不能进随机池（跟 assertPlayable 同口径）
 *
 * mood：可选心情筛选。用户在列表里选了「心情不好 / 平静」再进来玩耍时，
 * 换词也应该只在所筛选的心情范围内换（否则挑到开心卡，刷心情就白筛了）。
 *
 * ⚠️ 只按 mood_score（真实档位）过滤，**不看 had_wrong_attempt**：
 *    那个字段是「喂养拼写答错」的进行中标记，属于喂养流程，跟玩耍无关；
 *    它的 sad 只是展示层的临时叠加，若拿来过滤会把一张真正开心的卡
 *    从 happy 池里错误地剔除（用户会看到列表有这张卡、却永远换不到）。
 *    饥饿/蛋同理：先由下边的「可玩耍」窗口条件排除，不靠 mood。
 */
export async function pickRandomPlayableCard(userId: number, excludeCardId?: number, mood?: MoodType) {
  const now = Date.now();
  const params: unknown[] = [userId, now, now, now];
  let moodSql = '';
  if (mood === 'happy' || mood === 'sad' || mood === 'none') {
    // 按 mood_score 档位过滤，与 moodOf() 的阈值保持同一套 config（scoreHappy/scoreSad）
    if (mood === 'happy') {
      moodSql = ' AND uc.mood_score >= ?';
      params.push(config.play.scoreHappy);
    } else if (mood === 'sad') {
      moodSql = ' AND uc.mood_score <= ?';
      params.push(config.play.scoreSad);
    } else {
      moodSql = ' AND (uc.mood_score < ? AND uc.mood_score > ?)';
      params.push(config.play.scoreHappy, config.play.scoreSad);
    }
  }
  params.push(excludeCardId ?? null, excludeCardId ?? null);
  const [rows] = await pool.query<UserCardRow[]>(
    `SELECT uc.id, w.word
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     WHERE uc.user_id = ?
       AND (uc.abandoned IS NULL OR uc.abandoned = 0)
       AND uc.is_egg = 0
       AND uc.level > 0
       AND (
         (uc.feed_deadline > ?)                      -- 还没到喂养时间（健康）
         OR (? >= uc.feed_deadline AND ? < uc.feed_window_end)  -- 正在喂养窗口内
       )
       ${moodSql}
       AND (? IS NULL OR uc.id <> ?)
     ORDER BY RAND() LIMIT 1`,
    params
  );
  if (!rows[0]) return null;
  return { cardId: rows[0].id, word: rows[0].word || '' };
}

/**
 * 找下一个「可以喂养」的卡片
 *
 * 喂养完成后用户不想退回列表再点进来，想直接接着喂下一个。
 * 优先级：
 *   1. 饥饿中的卡（最想被救，用户最需要处理）
 *   2. 处于正常喂养窗口内的卡
 * 都找不到再回退到任一「未到时间但还存在」的卡，方便做「下一个」入口提示。
 *
 * @param excludeCardId 排除当前这张（默认从下张继续）
 * @param onlyHungry    true = 只找饥饿的卡
 */
export async function pickRandomFeedableCard(
  userId: number,
  excludeCardId?: number,
  onlyHungry = false
) {
  const now = Date.now();

  // ── 1. 饥饿中的卡（最优先）──
  const [hungryRows] = await pool.query<UserCardRow[]>(
    `SELECT uc.id, w.word, w.meaning
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     WHERE uc.user_id = ?
       AND (uc.abandoned IS NULL OR uc.abandoned = 0)
       AND uc.is_egg = 0
       AND uc.level > 0
       AND uc.hunger_start_at IS NOT NULL
       AND (? IS NULL OR uc.id <> ?)
     ORDER BY uc.hunger_start_at ASC
     LIMIT 1`,
    [userId, excludeCardId ?? null, excludeCardId ?? null]
  );
  if (hungryRows[0]) {
    return { cardId: hungryRows[0].id, word: hungryRows[0].word || '', reason: 'hungry' as const };
  }
  if (onlyHungry) return null;

  // ── 2. 正在喂养窗口内的卡 ──
  const [windowRows] = await pool.query<UserCardRow[]>(
    `SELECT uc.id, w.word, w.meaning
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     WHERE uc.user_id = ?
       AND (uc.abandoned IS NULL OR uc.abandoned = 0)
       AND uc.is_egg = 0
       AND uc.level > 0
       AND uc.hunger_start_at IS NULL
       AND uc.feed_deadline <= ?
       AND ? < uc.feed_window_end
       AND (? IS NULL OR uc.id <> ?)
     ORDER BY uc.feed_deadline ASC
     LIMIT 1`,
    [userId, now, now, excludeCardId ?? null, excludeCardId ?? null]
  );
  if (windowRows[0]) {
    return { cardId: windowRows[0].id, word: windowRows[0].word || '', reason: 'window' as const };
  }

  // ── 3. 有未完成补救喂养的卡 ──
  const [remedialRows] = await pool.query<UserCardRow[]>(
    `SELECT uc.id, w.word, w.meaning
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     WHERE uc.user_id = ?
       AND (uc.abandoned IS NULL OR uc.abandoned = 0)
       AND uc.is_egg = 0
       AND uc.level > 0
       AND uc.hunger_start_at IS NULL
       AND uc.remedial_feed_at IS NOT NULL
       AND uc.had_wrong_attempt = 1
       AND (? IS NULL OR uc.id <> ?)
     ORDER BY uc.remedial_feed_at ASC
     LIMIT 1`,
    [userId, excludeCardId ?? null, excludeCardId ?? null]
  );
  if (remedialRows[0]) {
    return { cardId: remedialRows[0].id, word: remedialRows[0].word || '', reason: 'remedial' as const };
  }

  return null;
}

/**
 * 出题：
 *  - mode='pick'      → 返回 4 个中文选项（1 正确 + 3 干扰，同书优先）
 *  - mode='translate' → 只需英文单词，用户手打中文
 */
export async function getPlayQuestion(userId: number, cardId: number, mode: PlayMode = 'pick') {
  const card = await loadOwnedCard(userId, cardId);
  if (!card) throw new Error('卡牌不存在或已被遗弃');
  assertPlayable(card);

  const clean = (s: unknown) => cleanMeaning(s, 12);
  const correctText = clean(card.meaning);
  if (!correctText) throw new Error('该单词释义为空，无法出题');

  const score = card.mood_score || 0;
  const base = {
    cardId: card.id,
    wordId: card.word_id,
    word: card.word || '',
    phonetic: card.phonetic || null,
    audioUrl: buildAudioUrl(card.word || '', card.audio_url),
    mode,
    moodScore: score,
    mood: moodOf(score),
    playCount: card.play_count || 0,
    playCorrectCount: card.play_correct_count || 0,
  };

  // 英译汉：不打选项，答案由后端判分（前端不泄露答案）
  if (mode === 'translate') {
    return { ...base, options: [], senses: [] };
  }

  const need = Math.max(1, config.play.optionCount - 1);

  // 干扰项：多抽一些，清洗后去重（避免「跑，奔跑」和「奔跑」同时出现）
  const rawPool: string[] = [];
  const lim = Number(need) * 6 || 18;
  const [sameBook] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT w.meaning FROM words w
     JOIN books b ON b.id = w.book_id
     WHERE b.book_code = ? AND w.id <> ? AND w.meaning IS NOT NULL AND w.meaning <> ''
     ORDER BY RAND() LIMIT ${lim}`,
    [card.book_code ?? '', card.word_id ?? 0]
  );
  sameBook.forEach((r) => rawPool.push(String(r.meaning)));

  const [globalRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT meaning FROM words
     WHERE id <> ? AND meaning IS NOT NULL AND meaning <> ''
     ORDER BY RAND() LIMIT ${lim * 2}`,
    [card.word_id ?? 0]
  );
  globalRows.forEach((r) => rawPool.push(String(r.meaning)));

  const distractors: string[] = [];
  for (const raw of rawPool) {
    if (distractors.length >= need) break;
    const t = clean(raw);
    if (!t || t === correctText) continue;
    if (distractors.includes(t)) continue;
    distractors.push(t);
  }
  if (distractors.length < need) {
    throw new Error('题库释义不足，无法生成 4 个选项');
  }

  const options = [
    { text: correctText, correct: true },
    ...distractors.slice(0, need).map((text) => ({ text, correct: false })),
  ].sort(() => Math.random() - 0.5);

  return { ...base, options, senses: [correctText, ...sensesOf(card.meaning).filter((s) => s !== correctText)].filter(Boolean) };
}

/**
 * 提交玩耍答案：答对 → mood_score +1（提升心情）；答错 → -1（降低心情）。
 * 答对额外奖励少量金币。
 *  - mode='pick'      ：answer 是选中的中文选项（严格相等）
 *  - mode='translate' ：answer 是手打的中文，命中任意一个义项即算对（容错判分）
 */
export async function playCard(userId: number, cardId: number, answer: string, mode: PlayMode = 'pick') {
  const card = await loadOwnedCard(userId, cardId);
  if (!card) throw new Error('卡牌不存在或已被遗弃');
  assertPlayable(card);
  if (!answer || typeof answer !== 'string') throw new Error('缺少答案');

  const displayMeaning = cleanMeaning(card.meaning, 12);
  const correct = mode === 'translate'
    ? judgeTranslation(answer, card.meaning)
    : answer.trim() === displayMeaning.trim();
  const delta = correct ? config.play.correctDelta : config.play.wrongDelta;
  const before = card.mood_score || 0;
  const after = Math.max(config.play.scoreMin, Math.min(config.play.scoreMax, before + delta));
  // 心情从「非开心」跨到「开心」时才给金币，防止反复刷
  const becameHappy = moodOf(before) !== 'happy' && moodOf(after) === 'happy';
  const coinReward = correct && becameHappy ? config.play.coinReward : 0;

  await pool.execute(
    `UPDATE user_cards
     SET mood_score = ?,
         play_count = play_count + 1,
         play_correct_count = play_correct_count + ?
     WHERE id = ? AND user_id = ?`,
    [after, correct ? 1 : 0, cardId, userId]
  );
  if (coinReward > 0) {
    await pool.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [coinReward, userId]);
  }

  const coins = await getUserCoins(userId);
  // 义项列表：首项统一用「显示释义」，其余为其它义项（前端可直接按首项对齐过滤）
  const allSenses = sensesOf(card.meaning);
  const otherSenses = allSenses.filter((s) => s !== displayMeaning);
  return {
    correct,
    correctMeaning: displayMeaning,
    acceptedAnswers: acceptedAnswers(card.meaning),
    senses: [displayMeaning, ...otherSenses].filter(Boolean),
    mode,
    moodScore: after,
    mood: moodOf(after),
    moodChanged: moodOf(before) !== moodOf(after),
    coinReward,
    coins,
    playCount: (card.play_count || 0) + 1,
    playCorrectCount: (card.play_correct_count || 0) + (correct ? 1 : 0),
    message: correct
      ? `答对了！${moodOf(after) === 'happy' ? '单词很开心 😊' : '心情 +1'}${coinReward ? ` 金币 +${coinReward}` : ''}`
      : `答错了，正确答案是「${displayMeaning}」。${moodOf(after) === 'sad' ? '单词很伤心 😢' : '心情 -1'}`,
  };
}
