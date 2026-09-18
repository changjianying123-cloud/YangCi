import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db/pool';
import { UserCardRow, WordRow } from '../types';
import { buildAudioUrl, nextFeedSchedule } from '../utils/cardStatus';
import { countMnemonics } from './mnemonicService';
import { getUserCatchRepeat } from './repeatSettings';

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
    // 有无助记 → 前端决定要不要显示「查看助记」入口
    mnemonicCount: await countMnemonics(word.id),
    // 该用户实际生效的收服重复次数（可在「我的」自定义）
    requiredCorrect: await getUserCatchRepeat(userId),
  };
}

export async function catchWord(userId: number, wordId: number, correctCount: number) {
  const [wordRows] = await pool.execute<WordRow[]>(
    'SELECT * FROM words WHERE id = ?',
    [wordId]
  );
  if (!wordRows[0]) throw new Error('单词不存在');

  const now = Date.now();
  const sd = nextFeedSchedule(0, 0, now);

  // 已收服过的（含未遗弃的）直接复用现有卡牌，不重复 INSERT、不重复发币
  const [existingRows] = await pool.execute<UserCardRow[]>(
    'SELECT * FROM user_cards WHERE user_id = ? AND word_id = ? AND (abandoned IS NULL OR abandoned = 0)',
    [userId, wordId]
  );
  if (existingRows[0]) {
    return { cardId: existingRows[0].id, reactivated: false, alreadyCaptured: true, coinReward: 0 };
  }

  // 已遗弃的可以重新激活
  const [abandonedRows] = await pool.execute<UserCardRow[]>(
    'SELECT * FROM user_cards WHERE user_id = ? AND word_id = ? AND abandoned = 1',
    [userId, wordId]
  );

  if (!abandonedRows[0]) {
    // 真正新收服才发币
    await pool.execute(
      'UPDATE users SET coins = coins + ? WHERE id = ?',
      [config.coins.catchReward, userId]
    );
  }

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
    return { cardId: abandonedRows[0].id, reactivated: true, coinReward: config.coins.catchReward };
  }

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end, last_feed_at, is_egg, feed_spell_count)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
      [userId, wordId, sd.level, sd.feedDeadline, sd.feedWindowEnd, now]
    );
    return { cardId: result.insertId, reactivated: false, coinReward: config.coins.catchReward };
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'ER_DUP_ENTRY') {
      throw new Error('该单词已被收服');
    }
    throw err;
  }
}

export async function checkCatchProgress(userId: number, wordId: number, correctCount: number) {
  // 用户可在「我的」里自定义收服重复次数，未设置则用全局默认
  const required = await getUserCatchRepeat(userId);
  if (correctCount < required) {
    return { captured: false, count: correctCount, required };
  }
  const result = await catchWord(userId, wordId, correctCount);
  return { captured: true, count: correctCount, required, ...result };
}

export async function checkCatchable(userId: number, wordId: number) {
  const [wordRows] = await pool.execute<WordRow[]>(
    'SELECT * FROM words WHERE id = ?',
    [wordId]
  );
  if (!wordRows[0]) return { catchable: false, reason: '单词不存在' };

  const [existingRows] = await pool.execute<UserCardRow[]>(
    'SELECT id FROM user_cards WHERE user_id = ? AND word_id = ? AND (abandoned IS NULL OR abandoned = 0)',
    [userId, wordId]
  );
  if (existingRows[0]) return { catchable: false, reason: '该单词已被收服' };

  return { catchable: true };
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
