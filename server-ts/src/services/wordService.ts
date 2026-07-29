import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db/pool';
import { WordRow } from '../types';
import { buildAudioUrl } from '../utils/cardStatus';

export async function getRandomWord(bookCode: string) {
  const [rows] = await pool.execute<WordRow[]>(
    `SELECT w.*, b.book_code
     FROM words w
     JOIN books b ON b.id = w.book_id
     WHERE b.book_code = ?
     ORDER BY RAND()
     LIMIT 1`,
    [bookCode]
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

  const now = Date.now();
  const level = 1;
  const intervalIdx = Math.min(level, config.card.feedIntervals.length) - 1;
  const intervalMs = config.card.feedIntervals[intervalIdx];
  const feedDeadline = now + intervalMs;
  const feedWindowEnd = feedDeadline + config.card.feedWindowMs;

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end, last_feed_at, hunger_start_at, downgrade_count, is_egg, feed_spell_count)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 0)`,
      [userId, wordId, level, feedDeadline, feedWindowEnd, now]
    );
    return { cardId: result.insertId };
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
    'SELECT word_id FROM user_cards WHERE user_id = ?',
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
