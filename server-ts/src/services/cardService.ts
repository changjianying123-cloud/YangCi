import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db/pool';
import { CardDTO, CardStatus, UserCardRow } from '../types';
import { buildAudioUrl, computeCardStatus, canFeedNow, nextFeedSchedule, downgradeSchedule } from '../utils/cardStatus';

function toCardDTO(row: UserCardRow): CardDTO {
  const now = Date.now();
  const isEgg = row.is_egg === 1;

  const status = computeCardStatus(
    row.level,
    row.feed_deadline,
    row.feed_window_end,
    row.hunger_start_at,
    row.downgrade_count,
    isEgg,
    now
  );

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
    canFeed: canFeedNow(row.level, row.feed_deadline, row.feed_window_end, isEgg, now),
    feedSpellCount: row.feed_spell_count || 0,
    feedSpellRequired: config.card.feedSpellCount,
    nextFeedIn: formatNextFeedIn(row.feed_deadline, row.feed_window_end, now),
  };
}

function formatNextFeedIn(feedDeadline: number, feedWindowEnd: number, now: number): string {
  if (now < feedDeadline) {
    const diff = feedDeadline - now;
    if (diff < 60 * 1000) return '即将可以喂养';
    if (diff < 60 * 60 * 1000) return `${Math.ceil(diff / (60 * 1000))}分钟后可以喂养`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.ceil(diff / (60 * 60 * 1000))}小时后可以喂养`;
    return `${Math.ceil(diff / (24 * 60 * 60 * 1000))}天后可以喂养`;
  }
  if (now < feedWindowEnd) return '🍼 可喂养';
  return '⏰ 已超时';
}

/**
 * 检测并更新饥饿→降级
 */
async function applyHungerDowngrade(rows: UserCardRow[], now: number) {
  for (const row of rows) {
    if (row.is_egg || row.level <= 0) continue;

    // 在窗口期内，重置饥饿标记
    if (now >= row.feed_deadline && now < row.feed_window_end) {
      if (row.hunger_start_at !== null) {
        await pool.execute('UPDATE user_cards SET hunger_start_at = NULL WHERE id = ?', [row.id]);
        row.hunger_start_at = null;
      }
      continue;
    }

    // 超过窗口期→进入饥饿
    if (now >= row.feed_window_end) {
      if (row.hunger_start_at === null) {
        await pool.execute('UPDATE user_cards SET hunger_start_at = ? WHERE id = ?', [now, row.id]);
        row.hunger_start_at = now;
        continue;
      }

      // 饥饿超过降级阈值→降级
      if (now >= row.hunger_start_at + config.card.downgradeThresholdMs) {
        const sd = downgradeSchedule(row.level, now);
        await pool.execute(
          `UPDATE user_cards SET level = ?, feed_deadline = ?, feed_window_end = ?, hunger_start_at = NULL, downgrade_count = downgrade_count + 1 WHERE id = ?`,
          [sd.level, sd.feedDeadline, sd.feedWindowEnd, row.id]
        );
        row.level = sd.level;
        row.feed_deadline = sd.feedDeadline;
        row.feed_window_end = sd.feedWindowEnd;
        row.hunger_start_at = null;
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
     WHERE uc.user_id = ?
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
  await applyHungerDowngrade(rows, now);
  return rows.map(toCardDTO);
}

export async function getCardDetail(userId: number, cardId: number): Promise<CardDTO | null> {
  const [rows] = await pool.execute<UserCardRow[]>(
    `SELECT uc.*, w.word, w.meaning, w.phonetic, w.audio_url, b.book_code, b.book_name
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     JOIN books b ON b.id = w.book_id
     WHERE uc.id = ? AND uc.user_id = ?`,
    [cardId, userId]
  );
  if (!rows[0]) return null;
  return toCardDTO(rows[0]);
}

export async function feedCard(userId: number, cardId: number, spellCorrect: boolean) {
  const now = Date.now();
  const [rows] = await pool.execute<UserCardRow[]>(
    `SELECT * FROM user_cards WHERE id = ? AND user_id = ?`,
    [cardId, userId]
  );
  if (!rows[0]) throw new Error('卡牌不存在');
  const row = rows[0];

  if (row.is_egg) throw new Error('单词蛋需要孵化，不能喂养');
  if (now < row.feed_deadline || now >= row.feed_window_end) throw new Error('现在不是喂养时间');

  // 拼写错误
  if (!spellCorrect) {
    return { done: false, spellCorrect: false, count: row.feed_spell_count || 0, required: config.card.feedSpellCount };
  }

  // 拼写正确
  const currentCount = (row.feed_spell_count || 0) + 1;

  // 检查是否达到需要拼写的次数
  if (currentCount >= config.card.feedSpellCount) {
    // 升级到下一阶段
    const sd = nextFeedSchedule(row.level, now);
    await pool.execute(
      `UPDATE user_cards SET level = ?, feed_deadline = ?, feed_window_end = ?, last_feed_at = ?, hunger_start_at = NULL, downgrade_count = 0, feed_spell_count = 0 WHERE id = ?`,
      [sd.level, sd.feedDeadline, sd.feedWindowEnd, now, cardId]
    );

    await pool.execute<ResultSetHeader>(
      'INSERT INTO feed_logs (user_id, card_id, spell_correct, read_aloud_clicked) VALUES (?, ?, ?, ?)',
      [userId, cardId, 1, 0]
    );

    return { done: true, count: currentCount, required: config.card.feedSpellCount };
  } else {
    // 还没拼够次数，更新计数
    await pool.execute('UPDATE user_cards SET feed_spell_count = ? WHERE id = ?', [currentCount, cardId]);
    return { done: false, count: currentCount, required: config.card.feedSpellCount };
  }
}

export async function getPendingFeedCards(userId: number) {
  const cards = await listUserCards(userId);
  return cards.filter((c) => c.status === 'incubating' || c.status === 'hungry');
}

export async function getCardCount(userId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS count FROM user_cards WHERE user_id = ?',
    [userId]
  );
  return Number(rows[0].count) || 0;
}

/**
 * 孵化单词蛋
 */
export async function hatchEgg(userId: number, cardId: number): Promise<CardDTO> {
  const card = await getCardDetail(userId, cardId);
  if (!card) throw new Error('卡牌不存在');
  if (!card.isEgg) throw new Error('这不是单词蛋，无需孵化');

  const now = Date.now();
  const sd = nextFeedSchedule(0, now);

  await pool.execute(
    `UPDATE user_cards SET level = ?, feed_deadline = ?, feed_window_end = ?, last_feed_at = ?, hunger_start_at = NULL, downgrade_count = 0, is_egg = 0, feed_spell_count = 0 WHERE id = ?`,
    [sd.level, sd.feedDeadline, sd.feedWindowEnd, now, cardId]
  );

  return getCardDetail(userId, cardId) as Promise<CardDTO>;
}
