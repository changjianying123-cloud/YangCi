import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db/pool';
import { UserCardRow, WordRow } from '../types';
import { buildAudioUrl, nextFeedSchedule } from '../utils/cardStatus';

export async function getRandomWord(userId: number, bookCode: string) {
  const [rows] = await pool.execute<WordRow[]>(
    `SELECT w.*, b.book_code
     FROM words w
     JOIN books b ON b.id = w.book_id
     WHERE b.book_code = ?
       AND w.id NOT IN (
         SELECT word_id FROM user_cards WHERE user_id = ? AND (abandoned IS NULL OR abandoned = 0)
       )
     ORDER BY RAND()
     LIMIT 1`,
    [bookCode, userId]
  );
  const word = rows[0];
  if (!word) return null;
  return {
    id: word.id,
    word: word.word,
    meaning: word.meaning,
    phonetic: word.phonetic,
    audioUrl: buildAudioUrl(word.word, word.audio_url),
    bookCode: word.book_code,
  };
}

export async function catchWord(userId: number, wordId: number, correctCount: number) {
  const [wordRows] = await pool.execute<WordRow[]>(
    'SELECT * FROM words WHERE id = ?',
    [wordId]
  );
  if (!wordRows[0]) throw new Error('单词不存在');

  // 已遗弃的可以重新激活
  const [abandonedRows] = await pool.execute<UserCardRow[]>(
    'SELECT * FROM user_cards WHERE user_id = ? AND word_id = ? AND abandoned = 1',
    [userId, wordId]
  );

  const now = Date.now();
  const sd = nextFeedSchedule(0, 0, now);

  if (abandonedRows[0]) {
    // 重新激活
    await pool.execute(
      `UPDATE user_cards
       SET level = ?, feed_deadline = ?, feed_window_end = ?,
           last_feed_at = ?, hunger_start_at = NULL, downgrade_count = 0,
           is_egg = 0, feed_spell_count = 0, had_wrong_attempt = 0,
           remedial_feed_at = NULL, abandoned = 0, abandoned_at = NULL
       WHERE id = ?`,
      [sd.level, sd.feedDeadline, sd.feedWindowEnd, now, abandonedRows[0].id]
    );
    return { cardId: abandonedRows[0].id, reactivated: true };
  }

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end, last_feed_at, is_egg, feed_spell_count)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
      [userId, wordId, sd.level, sd.feedDeadline, sd.feedWindowEnd, now]
    );
    return { cardId: result.insertId, reactivated: false };
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'ER_DUP_ENTRY') {
      throw new Error('该单词已被收服');
    }
    throw err;
  }
}

export async function checkCatchProgress(userId: number, wordId: number, correctCount: number) {
  const required = config.card.catchRequiredCorrect;
  if (correctCount < required) {
    return { captured: false, count: correctCount, required };
  }
  const result = await catchWord(userId, wordId, correctCount);
  return { captured: true, count: correctCount, required, ...result };
}

export async function listCapturedWordIds(userId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT word_id FROM user_cards WHERE user_id = ? AND (abandoned IS NULL OR abandoned = 0)',
    [userId]
  );
  return rows.map((r) => r.word_id as number);
}

export async function getWordDetail(wordId: number) {
  const [rows] = await pool.execute<WordRow[]>(
    `SELECT w.*, b.book_code, b.book_name
     FROM words w
     JOIN books b ON b.id = w.book_id
     WHERE w.id = ?`,
    [wordId]
  );
  const word = rows[0];
  if (!word) return null;
  return {
    id: word.id,
    word: word.word,
    meaning: word.meaning,
    phonetic: word.phonetic,
    audioUrl: buildAudioUrl(word.word, word.audio_url),
    bookCode: word.book_code,
    bookName: word.book_name,
  };
}
