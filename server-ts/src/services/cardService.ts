import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db/pool';
import { CardDTO, CardStatus, MoodType, UserCardRow, UserRow } from '../types';
import {
  buildAudioUrl,
  computeCardStatus,
  canFeedNow,
  nextFeedSchedule,
  downgradeSchedule,
  getWindowInfo,
  getRemedialInfo,
  getLv1Info,
  getFeedCoinReward,
  isHungryNeedCoins,
  canAffordRecover,
} from '../utils/cardStatus';
import { cleanMeaning } from '../utils/meaning';

async function getUserCoins(userId: number): Promise<number> {
  const [rows] = await pool.execute<UserRow[]>(
    'SELECT coins FROM users WHERE id = ?',
    [userId]
  );
  return rows[0]?.coins ?? 0;
}

function toCardDTO(row: UserCardRow, userCoins: number = 0): CardDTO {
  const now = Date.now();
  const isEgg = row.is_egg === 1;
  const status = computeCardStatus(
    row.level, row.feed_deadline, row.feed_window_end,
    row.hunger_start_at, row.downgrade_count, isEgg, now
  );

  const windowInfo = getWindowInfo(row.feed_deadline, row.feed_window_end, now);
  const remedialInfo = getRemedialInfo(row.remedial_feed_at ?? null, now);
  const lv1Info = getLv1Info(row.level, row.feed_spell_count || 0);

  // 心情：玩耍累计的 mood_score 为准；喂养拼写错过则临时叠一层 sad
  const moodScore = row.mood_score || 0;
  let mood: MoodType = moodScore >= 1 ? 'happy' : moodScore <= -1 ? 'sad' : 'none';
  if (row.had_wrong_attempt === 1) mood = 'sad';

  // 是否可以喂养（含补救窗口）
  const canFeed = canFeedNow(row.level, row.feed_deadline, row.feed_window_end, isEgg, row.remedial_feed_at ?? null, now);

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
    feedSpellCount: Math.max(0, Math.min(row.feed_spell_count || 0, config.card.feedSpellCount || 3)),
    feedSpellRequired: config.card.feedSpellCount || 3,
    // 还剩几次拼写（倒着数：3 → 2 → 1）
    feedSpellRemaining: Math.max(0, (config.card.feedSpellCount || 3) - (row.feed_spell_count || 0)),
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
    isHungry: status === 'hungry' || status === 'downgraded',
    canRecoverFromHunger: !canFeed && (status === 'hungry' || status === 'downgraded') && canAffordRecover(userCoins),
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

      // 饥饿超过降级阈值 → 降级
      if (now >= row.hunger_start_at + config.card.downgradeThresholdMs) {
        const sd = downgradeSchedule(row.level, now);
        await pool.execute(
          `UPDATE user_cards
           SET level = ?, feed_deadline = ?, feed_window_end = ?,
               hunger_start_at = NULL, downgrade_count = downgrade_count + 1,
               feed_spell_count = 0, had_wrong_attempt = 0, remedial_feed_at = NULL
           WHERE id = ?`,
          [sd.level, sd.feedDeadline, sd.feedWindowEnd, row.id]
        );
        row.level = sd.level;
        row.feed_deadline = sd.feedDeadline;
        row.feed_window_end = sd.feedWindowEnd;
        row.hunger_start_at = null;
        row.feed_spell_count = 0;
        row.had_wrong_attempt = 0;
        row.remedial_feed_at = null;
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
         WHEN uc.is_egg = 1 THEN 4
         WHEN uc.feed_deadline <= ? AND ? < uc.feed_window_end THEN 0
         WHEN uc.hunger_start_at IS NOT NULL AND ? >= uc.hunger_start_at + ? THEN 3
         WHEN uc.hunger_start_at IS NOT NULL THEN 1
         ELSE 2
       END,
       uc.feed_deadline ASC`,
    [userId, now, now, now, config.card.downgradeThresholdMs]
  );
  await processHungerDowngrade(rows, now);
  const userCoins = await getUserCoins(userId);
  return rows.map((r) => toCardDTO(r, userCoins));
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
  return toCardDTO(rows[0], userCoins);
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

  // 本轮喂养的拼写次数要求：健康喂养与「拼错后补考」统一，都是 3 次，
  // 避免中途 required 跳变导致前端进度出现 1→2→3 这种反过来的显示
  const requiredFeeds = Math.max(1, config.card.feedSpellCount || 3);
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

  const required = Math.max(1, config.card.feedSpellCount || 3);
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

// ===== 玩耍（英文选中文四选一）=====

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
 * 随机挑一张可玩耍的卡（排除当前的 cardId）。
 * “继续玩耍”换一个单词，但不能把用户自己带上别的卡。
 */
export async function pickRandomPlayableCard(userId: number, excludeCardId?: number) {
  const [rows] = await pool.query<UserCardRow[]>(
    `SELECT uc.id, w.word
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     WHERE uc.user_id = ?
       AND (uc.abandoned IS NULL OR uc.abandoned = 0)
       AND uc.is_egg = 0
       AND uc.level > 0
       AND (? IS NULL OR uc.id <> ?)
     ORDER BY RAND() LIMIT 1`,
    [userId, excludeCardId ?? null, excludeCardId ?? null]
  );
  if (!rows[0]) return null;
  return { cardId: rows[0].id, word: rows[0].word || '' };
}

/**
 * 出题：当前单词的英文 + 4 个中文选项（1 正确 + 3 干扰）。
 * 干扰项优先从「同本书」抽，不够再全库抽。
 */
export async function getPlayQuestion(userId: number, cardId: number) {
  const card = await loadOwnedCard(userId, cardId);
  if (!card) throw new Error('卡牌不存在或已被遗弃');

  const need = Math.max(1, config.play.optionCount - 1);
  const clean = (s: unknown) => cleanMeaning(s, 12);
  const correctText = clean(card.meaning);
  if (!correctText) throw new Error('该单词释义为空，无法出题');

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

  const score = card.mood_score || 0;
  return {
    cardId: card.id,
    wordId: card.word_id,
    word: card.word || '',
    phonetic: card.phonetic || null,
    audioUrl: buildAudioUrl(card.word || '', card.audio_url),
    options,
    moodScore: score,
    mood: moodOf(score),
    playCount: card.play_count || 0,
    playCorrectCount: card.play_correct_count || 0,
  };
}

/**
 * 提交玩耍答案：答对 → mood_score +1（提升心情）；答错 → -1（降低心情）。
 * 答对额外奖励少量金币。
 */
export async function playCard(userId: number, cardId: number, answer: string) {
  const card = await loadOwnedCard(userId, cardId);
  if (!card) throw new Error('卡牌不存在或已被遗弃');
  if (!answer || typeof answer !== 'string') throw new Error('缺少答案');

  const correct = answer.trim() === cleanMeaning(card.meaning, 12).trim();
  const displayMeaning = cleanMeaning(card.meaning, 12);
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
  return {
    correct,
    correctMeaning: displayMeaning,
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
