import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool';
import { BookRow } from '../types';

export async function listBooks(userId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      b.id, b.book_code, b.book_name, b.icon, b.color, b.total_words,
      COUNT(DISTINCT uc.id) AS caught_count
    FROM books b
    LEFT JOIN words w ON w.book_id = b.id
    LEFT JOIN user_cards uc ON uc.word_id = w.id AND uc.user_id = ? AND (uc.abandoned IS NULL OR uc.abandoned = 0)
    GROUP BY b.id
    ORDER BY b.id ASC
    `,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    bookCode: row.book_code,
    bookName: row.book_name,
    icon: row.icon,
    color: row.color,
    totalWords: row.total_words,
    caughtCount: Number(row.caught_count) || 0,
  }));
}

export async function getBookByCode(bookCode: string) {
  const [rows] = await pool.execute<BookRow[]>(
    'SELECT * FROM books WHERE book_code = ?',
    [bookCode]
  );
  return rows[0] || null;
}
