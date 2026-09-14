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

  // 心情：本轮拼写错过 → sad
  let mood: MoodType = 'none';
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
    feedSpellCount: row.feed_spell_count || 0,
    feedSpellRequired: config.card.feedSpellCount,
    nextFeedIn: remedialInfo.hasRemedial ? remedialInfo.humanReadable : windowInfo.humanReadable,
    mood,
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
 */
function getRequiredFeedsForLevel(level: number): number {
  // 如果之前拼写错了，需要 3 次；否则默认 3 次
  return 3;
}

export async function feedCard(userId: number, cardId: number, spellCorrect: boolean, recoverHunger: boolean = false) {
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
  const feedingInHunger = isHungryStatus && (recoverHunger || !inNormalWindow && !inRemedialWindow);

  // 饥饿状态下，必须花费金币恢复才能喂养
  if (isHungryStatus && !inNormalWindow && !inRemedialWindow) {
    if (!recoverHunger) {
      throw new Error('单词饥饿中，需要消耗10金币恢复后才能喂养');
    }
    if (userCoins < config.coins.recoverCost) {
      throw new Error('金币不足，无法恢复饥饿状态');
    }
    // 扣金币
    await pool.execute(
      'UPDATE users SET coins = coins - ? WHERE id = ?',
      [config.coins.recoverCost, userId]
    );
  }

  // 如果不在正常窗口也不在补救窗口，但已扣费恢复，则强行开启窗口
  if (!inNormalWindow && !inRemedialWindow && isHungryStatus && recoverHunger) {
    // 将 feed_deadline 设置为现在（饥饿恢复后立即可以喂养）
    await pool.execute(
      `UPDATE user_cards
       SET feed_deadline = ?, feed_window_end = ?,
           hunger_start_at = NULL, downgrade_count = 0
       WHERE id = ?`,
      [now, now + config.card.hungerWindowMs, cardId]
    );
    // 重新读取
    const [updatedRows] = await pool.execute<UserCardRow[]>(
      `SELECT * FROM user_cards WHERE id = ? AND user_id = ?`,
      [cardId, userId]
    );
    row.feed_deadline = now;
    row.feed_window_end = now + config.card.hungerWindowMs;
    row.hunger_start_at = null;
    row.downgrade_count = 0;
  } else if (!inNormalWindow && !inRemedialWindow && !feedingInHunger) {
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

    // 重置喂养拼写计数，改为需要拼写 3 次才能喂养成功
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
      required: 3,
      level: row.level,
      hadWrong: true,
      coinPenalty: penaltyCoin,
      message: penaltyCoin > 0
        ? `拼写错误，扣除 ${penaltyCoin} 💰，需要重新拼写 3 次才能喂养成功 😢`
        : '拼写错误，需要重新拼写 3 次才能喂养成功 😢',
    };
  }

  // ── 拼写正确 ──
  const currentCount = (row.feed_spell_count || 0) + 1;
  const hadWrong = row.had_wrong_attempt === 1;
  // 如果之前拼写错过，需要 3 次才完成；否则按等级所需次数
  const requiredFeeds = hadWrong ? 3 : getRequiredFeedsForLevel(row.level);

  // 本轮是否有补救窗口，且本次喂养是否在补救窗口中
  const feedingInRemedialWindow = inRemedialWindow && row.remedial_feed_at !== null;
  // 是否在饥饿恢复后喂养（饥饿状态不获得金币）
  const feedingAfterHungerRecover = feedingInHunger || (isHungryStatus && (recoverHunger || !inNormalWindow && !inRemedialWindow));
  // 是否是正常健康状态喂养（可以获得金币）
  const isHealthyFeed = !isHungryStatus && (inNormalWindow || inRemedialWindow) && !feedingAfterHungerRecover;

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
    // Lv.1 还需要再喂一次
    let remedialFeedAt: number | null = null;
    if (hadWrong && !feedingInRemedialWindow) {
      remedialFeedAt = now + config.card.remedialFeedDelayMs;
    }

    await pool.execute(
      `UPDATE user_cards
       SET feed_spell_count = ?, had_wrong_attempt = 0, remedial_feed_at = ?
       WHERE id = ?`,
      [currentCount, remedialFeedAt, cardId]
    );

    const remaining = requiredFeeds - currentCount;
    return {
      done: false,
      spellCorrect: true,
      mood: 'happy' as MoodType,
      moodEmoji: '😊',
      count: currentCount,
      required: requiredFeeds,
      level: row.level,
      coinReward,
      isLv1Second: true,
      hadWrong,
      hasRemedial: hadWrong,
      message: `拼写正确！😊 还需 ${remaining} 次喂养才升级` + (coinReward > 0 ? ` 获得 ${coinReward} 🪙` : ''),
    };
  }
}

export async function getPendingFeedCards(userId: number) {
  const cards = await listUserCards(userId);
  return cards.filter((c) => c.canFeed);
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
