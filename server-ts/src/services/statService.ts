import { RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db/pool';
import { getCardCount } from './cardService';

export async function getUserStats(userId: number) {
  const totalCards = await getCardCount(userId);

  const now = Date.now();

  // 获取用户金币
  const [userRows] = await pool.execute<RowDataPacket[]>(
    'SELECT coins FROM users WHERE id = ?',
    [userId]
  );
  const coins = Number(userRows[0]?.coins) || 0;
  const [statusRows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      SUM(CASE WHEN is_egg = 0 AND feed_deadline <= ? AND ? < feed_window_end THEN 1 ELSE 0 END) AS hungry_count,
      SUM(CASE WHEN is_egg = 1 THEN 1 ELSE 0 END) AS egg_count,
      SUM(CASE WHEN is_egg = 0 AND feed_deadline > ? THEN 1 ELSE 0 END) AS healthy_count
    FROM user_cards
    WHERE user_id = ? AND (abandoned IS NULL OR abandoned = 0)
    `,
    [now, now, now, userId]
  );

  const [feedRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS feed_count FROM feed_logs WHERE user_id = ?',
    [userId]
  );

  const [bookRows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT b.book_code, b.book_name, COUNT(uc.id) AS caught_count
    FROM books b
    LEFT JOIN words w ON w.book_id = b.id
    LEFT JOIN user_cards uc ON uc.word_id = w.id AND uc.user_id = ? AND (uc.abandoned IS NULL OR uc.abandoned = 0)
    GROUP BY b.id
    ORDER BY b.id
    `,
    [userId]
  );

  const [recentRows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT DATE(created_at) AS day, COUNT(*) AS count
    FROM feed_logs
    WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY DATE(created_at)
    ORDER BY day ASC
    `,
    [userId]
  );

  return {
    totalCards,
    coins,
    healthyCount: Number(statusRows[0]?.healthy_count) || 0,
    hungryCount: Number(statusRows[0]?.hungry_count) || 0,
    eggCount: Number(statusRows[0]?.egg_count) || 0,
    totalFeeds: Number(feedRows[0]?.feed_count) || 0,
    bookProgress: bookRows.map((r) => ({
      bookCode: r.book_code,
      bookName: r.book_name,
      caughtCount: Number(r.caught_count) || 0,
    })),
    recentFeeds: recentRows.map((r) => ({
      day: r.day,
      count: Number(r.count) || 0,
    })),
  };
}
