import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool';
import crypto from 'crypto';
import { onlineCount } from '../ws/hub';

/**
 * 把 MySQL 的 timestamp 统一成毫秒时间戳，供前端直接 new Date(ms) 使用。
 * mysql2 对 DATETIME/TIMESTAMP 返回的是 JS Date 对象，直接 Number() 会得到 NaN，
 * 旧前端因此显示 “NaN-NaN-NaN”。这里在服务端一次归一化，前端无需再兼容字符串。
 */
function toMillis(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

// ==================== 单词管理 ====================

export async function adminListWords(opts: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  bookCode?: string;
}) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: any[] = [];
  if (opts.keyword) {
    where.push('(w.word LIKE ? OR w.meaning LIKE ?)');
    params.push(`%${opts.keyword}%`, `%${opts.keyword}%`);
  }
  if (opts.bookCode) {
    where.push('b.book_code = ?');
    params.push(opts.bookCode);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM words w JOIN books b ON b.id = w.book_id ${whereSql}`,
    params
  );
  const total = Number((countRows[0] as { total: number })?.total) || 0;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT w.*, b.book_code, b.book_name,
            (SELECT COUNT(*) FROM user_cards uc WHERE uc.word_id = w.id) AS captured_count
     FROM words w
     JOIN books b ON b.id = w.book_id
     ${whereSql}
     ORDER BY w.id DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      bookId: r.book_id,
      bookCode: r.book_code,
      bookName: r.book_name,
      word: r.word,
      phonetic: r.phonetic,
      meaning: r.meaning,
      pos: r.pos,
      exampleSentence: r.example_sentence,
      audioUrl: r.audio_url,
      capturedCount: Number(r.captured_count) || 0,
    })),
    total,
    page,
    pageSize,
  };
}

export async function adminCreateWord(data: {
  bookId: number;
  word: string;
  meaning: string;
  phonetic?: string;
  pos?: string;
  exampleSentence?: string;
  audioUrl?: string;
}) {
  if (!data.bookId) throw new Error('请选择词书');
  const word = (data.word || '').trim();
  const meaning = (data.meaning || '').trim();
  if (!word) throw new Error('单词不能为空');
  if (!meaning) throw new Error('释义不能为空');

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO words (book_id, word, phonetic, meaning, audio_url, example_sentence, pos)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.bookId,
        word,
        data.phonetic || null,
        meaning,
        data.audioUrl || null,
        data.exampleSentence || null,
        data.pos || null,
      ]
    );
    await refreshBookWordCount(data.bookId);
    return { id: result.insertId };
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'ER_DUP_ENTRY') throw new Error('该词书中已存在此单词');
    throw err;
  }
}

export async function adminUpdateWord(
  wordId: number,
  data: {
    bookId?: number;
    word?: string;
    meaning?: string;
    phonetic?: string | null;
    pos?: string | null;
    exampleSentence?: string | null;
    audioUrl?: string | null;
  }
) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM words WHERE id = ?', [wordId]);
  const cur = rows[0];
  if (!cur) throw new Error('单词不存在');

  // 只更新显式传入的字段（undefined = 不动）
  const sets: string[] = [];
  const params: any[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`\`${col}\` = ?`);
    params.push(val);
  };
  if (data.bookId !== undefined) put('book_id', data.bookId);
  if (data.word !== undefined) put('word', String(data.word).trim());
  if (data.meaning !== undefined) put('meaning', String(data.meaning).trim());
  if (data.phonetic !== undefined) put('phonetic', data.phonetic);
  if (data.pos !== undefined) put('pos', data.pos);
  if (data.exampleSentence !== undefined) put('example_sentence', data.exampleSentence);
  if (data.audioUrl !== undefined) put('audio_url', data.audioUrl);

  if (!sets.length) return { updated: false };

  const oldBookId = cur.book_id as number;
  params.push(wordId);
  try {
    await pool.execute(`UPDATE words SET ${sets.join(', ')} WHERE id = ?`, params);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'ER_DUP_ENTRY') throw new Error('该词书中已存在此单词');
    throw err;
  }

  if (data.bookId !== undefined && data.bookId !== oldBookId) {
    await refreshBookWordCount(oldBookId);
    await refreshBookWordCount(data.bookId);
  }
  return { updated: true };
}

/** 删除单词：级联删掉所有用户已收服的卡（高危，前端需二次确认） */
export async function adminDeleteWord(wordId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT book_id, word FROM words WHERE id = ?',
    [wordId]
  );
  const cur = rows[0];
  if (!cur) throw new Error('单词不存在');

  const [affected] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS c FROM user_cards WHERE word_id = ?',
    [wordId]
  );
  const cardCount = Number((affected[0] as { c: number })?.c) || 0;

  // feed_logs 有外键指向 user_cards，先删日志再删卡再删词
  await pool.execute(
    'DELETE fl FROM feed_logs fl JOIN user_cards uc ON uc.id = fl.card_id WHERE uc.word_id = ?',
    [wordId]
  );
  await pool.execute('DELETE FROM user_cards WHERE word_id = ?', [wordId]);
  await pool.execute('DELETE FROM words WHERE id = ?', [wordId]);
  await refreshBookWordCount(cur.book_id as number);

  return { deleted: true, removedCards: cardCount };
}

async function refreshBookWordCount(bookId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS c FROM words WHERE book_id = ?',
    [bookId]
  );
  await pool.execute('UPDATE books SET total_words = ? WHERE id = ?', [
    Number((rows[0] as { c: number })?.c) || 0,
    bookId,
  ]);
}

// ==================== 用户管理 ====================

export async function adminListUsers(opts: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  banned?: boolean;
  adminOnly?: boolean;
}) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: any[] = [];
  if (opts.keyword) {
    where.push('(u.username LIKE ? OR u.nickname LIKE ? OR u.openid LIKE ? OR u.id = ?)');
    const asNum = Number(opts.keyword);
    params.push(`%${opts.keyword}%`, `%${opts.keyword}%`, `%${opts.keyword}%`, Number.isFinite(asNum) ? asNum : -1);
  }
  if (opts.banned !== undefined) {
    where.push('u.is_banned = ?');
    params.push(opts.banned ? 1 : 0);
  }
  if (opts.adminOnly) {
    where.push('u.is_admin = 1');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
    params
  );
  const total = Number((countRows[0] as { total: number })?.total) || 0;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id, u.username, u.nickname, u.avatar_url, u.openid, u.coins,
            u.is_admin, u.is_banned, u.created_at, u.last_active_at,
            (SELECT COUNT(*) FROM user_cards uc WHERE uc.user_id = u.id AND (uc.abandoned IS NULL OR uc.abandoned = 0)) AS card_count
     FROM users u
     ${whereSql}
     ORDER BY u.id DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  const now = Date.now();
  const ONLINE_WINDOW = 5 * 60 * 1000;

  return {
    items: rows.map((r) => ({
      id: r.id,
      username: r.username,
      nickname: r.nickname,
      avatarUrl: r.avatar_url,
      openid: r.openid,
      coins: Number(r.coins) || 0,
      isAdmin: r.is_admin === 1,
      isBanned: r.is_banned === 1,
      cardCount: Number(r.card_count) || 0,
      createdAt: toMillis(r.created_at),
      lastActiveAt: r.last_active_at ? Number(r.last_active_at) : null,
      recentlyActive: r.last_active_at ? now - Number(r.last_active_at) < ONLINE_WINDOW : false,
    })),
    total,
    page,
    pageSize,
  };
}

export async function adminUserDetail(userId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id, u.username, u.nickname, u.avatar_url, u.openid, u.coins,
            u.is_admin, u.is_banned, u.created_at, u.last_active_at
     FROM users u WHERE u.id = ?`,
    [userId]
  );
  const u = rows[0];
  if (!u) throw new Error('用户不存在');

  const now = Date.now();
  const [cardStats] = await pool.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN is_egg = 1 THEN 1 ELSE 0 END) AS eggs,
       SUM(CASE WHEN abandoned = 1 THEN 1 ELSE 0 END) AS abandoned,
       SUM(CASE WHEN is_egg = 0 AND (abandoned IS NULL OR abandoned = 0) AND feed_deadline > ? THEN 1 ELSE 0 END) AS healthy,
       SUM(CASE WHEN is_egg = 0 AND (abandoned IS NULL OR abandoned = 0) AND feed_deadline <= ? AND feed_window_end > ? THEN 1 ELSE 0 END) AS incubating,
       SUM(CASE WHEN is_egg = 0 AND (abandoned IS NULL OR abandoned = 0) AND feed_window_end <= ? THEN 1 ELSE 0 END) AS hungry
     FROM user_cards WHERE user_id = ?`,
    [now, now, now, now, userId]
  );
  const cs = (cardStats[0] || {}) as Record<string, unknown>;

  const [levelRows] = await pool.execute<RowDataPacket[]>(
    `SELECT level, COUNT(*) AS c FROM user_cards
     WHERE user_id = ? AND is_egg = 0 AND (abandoned IS NULL OR abandoned = 0)
     GROUP BY level ORDER BY level`,
    [userId]
  );

  const [battleRows] = await pool.execute<RowDataPacket[]>(
    // 用户可能作为挑战者(player)或对手(enemy)，两边都要算
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
            SUM(CASE WHEN finished_at IS NOT NULL AND
                          ((player_user_id = ? AND winner = 1) OR
                           (enemy_user_id  = ? AND winner = 0)) THEN 1 ELSE 0 END) AS wins
     FROM battles WHERE player_user_id = ? OR enemy_user_id = ?`,
    [userId, userId, userId, userId]
  );
  const bs = (battleRows[0] || {}) as Record<string, unknown>;

  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatarUrl: u.avatar_url,
    openid: u.openid,
    coins: Number(u.coins) || 0,
    isAdmin: u.is_admin === 1,
    isBanned: u.is_banned === 1,
    createdAt: toMillis(u.created_at),
    lastActiveAt: u.last_active_at ? Number(u.last_active_at) : null,
    cards: {
      total: Number(cs.total) || 0,
      healthy: Number(cs.healthy) || 0,
      incubating: Number(cs.incubating) || 0,
      hungry: Number(cs.hungry) || 0,
      eggs: Number(cs.eggs) || 0,
      abandoned: Number(cs.abandoned) || 0,
      byLevel: levelRows.map((r) => ({ level: r.level, count: Number(r.c) || 0 })),
    },
    battles: {
      total: Number(bs.total) || 0,
      finished: Number(bs.finished) || 0,
      wins: Number(bs.wins) || 0,
    },
  };
}

export async function adminUpdateUser(
  userId: number,
  data: {
    nickname?: string;
    coins?: number;
    coinsDelta?: number;
    isAdmin?: boolean;
    isBanned?: boolean;
  }
) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!rows[0]) throw new Error('用户不存在');

  const sets: string[] = [];
  const params: any[] = [];
  if (data.nickname !== undefined) {
    sets.push('nickname = ?');
    params.push(String(data.nickname).trim());
  }
  if (data.coins !== undefined) {
    sets.push('coins = ?');
    params.push(Math.max(0, Math.floor(Number(data.coins))));
  } else if (data.coinsDelta !== undefined) {
    sets.push('coins = GREATEST(0, coins + ?)');
    params.push(Math.floor(Number(data.coinsDelta)));
  }
  if (data.isAdmin !== undefined) {
    sets.push('is_admin = ?');
    params.push(data.isAdmin ? 1 : 0);
  }
  if (data.isBanned !== undefined) {
    sets.push('is_banned = ?');
    params.push(data.isBanned ? 1 : 0);
  }
  if (!sets.length) return { updated: false };

  params.push(userId);
  await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  return { updated: true };
}

export async function adminResetPassword(userId: number, newPassword: string) {
  if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 64) {
    throw new Error('密码长度需为 6-64 位');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(newPassword, salt, 64).toString('hex');
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM users WHERE id = ?', [userId]);
  if (!rows[0]) throw new Error('用户不存在');
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [`${salt}:${hash}`, userId]);
  return { reset: true };
}

// ==================== 统计 ====================

export async function adminDashboard() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const ONLINE_WINDOW = 5 * 60 * 1000;

  const [userRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at >= CURDATE() THEN 1 ELSE 0 END) AS today_new,
            SUM(CASE WHEN last_active_at >= ? THEN 1 ELSE 0 END) AS active_5min,
            SUM(CASE WHEN last_active_at >= ? THEN 1 ELSE 0 END) AS dau,
            SUM(CASE WHEN is_banned = 1 THEN 1 ELSE 0 END) AS banned
     FROM users`,
    [now - ONLINE_WINDOW, now - dayMs]
  );
  const us = (userRows[0] || {}) as Record<string, unknown>;

  const [wordRows] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS c FROM words');
  const [cardRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM user_cards WHERE (abandoned IS NULL OR abandoned = 0)`
  );
  const [eggRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS c FROM user_cards WHERE is_egg = 1'
  );
  const [battleRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS ongoing
     FROM battles`
  );
  const bsr = (battleRows[0] || {}) as Record<string, unknown>;

  const [roomRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'playing' THEN 1 ELSE 0 END) AS playing
     FROM battle_rooms WHERE status NOT IN ('finished','cancelled')`
  );
  const rs = (roomRows[0] || {}) as Record<string, unknown>;

  return {
    users: {
      total: Number(us.total) || 0,
      todayNew: Number(us.today_new) || 0,
      dau: Number(us.dau) || 0,
      active5min: Number(us.active_5min) || 0,
      banned: Number(us.banned) || 0,
    },
    online: {
      wsConnections: onlineCount(),
      active5min: Number(us.active_5min) || 0,
    },
    words: {
      total: Number((wordRows[0] as { c: number })?.c) || 0,
    },
    cards: {
      total: Number((cardRows[0] as { c: number })?.c) || 0,
      eggs: Number((eggRows[0] as { c: number })?.c) || 0,
    },
    battles: {
      total: Number(bsr.total) || 0,
      ongoing: Number(bsr.ongoing) || 0,
    },
    rooms: {
      open: Number(rs.total) || 0,
      playing: Number(rs.playing) || 0,
    },
  };
}

/** 趋势：最近 N 天每天的新增用户 */
export async function adminTrend(days = 14) {
  const n = Math.min(60, Math.max(1, days));
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS c
     FROM users
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY d ORDER BY d`,
    [n]
  );

  // 补零，保证前端图表连续
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.d as string, Number(r.c) || 0);
  const out: Array<{ date: string; newUsers: number }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: key, newUsers: map.get(key) || 0 });
  }
  return out;
}

/** 当前在线用户明细（近 5 分钟活跃 + 是否正在对战） */
export async function adminOnlineUsers() {
  const now = Date.now();
  const ONLINE_WINDOW = 5 * 60 * 1000;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id, u.username, u.nickname, u.coins, u.last_active_at,
            (SELECT COUNT(*) FROM user_cards uc WHERE uc.user_id = u.id AND (uc.abandoned IS NULL OR uc.abandoned = 0) AND uc.is_egg = 0) AS card_count
     FROM users u
     WHERE u.last_active_at >= ?
     ORDER BY u.last_active_at DESC
     LIMIT 200`,
    [now - ONLINE_WINDOW]
  );

  // 正在对战的用户（房间未结束）
  const [roomRows] = await pool.execute<RowDataPacket[]>(
    `SELECT r.id AS room_id, r.status, r.bet,
            r.owner_user_id, r.guest_user_id,
            uo.nickname AS owner_nickname, ug.nickname AS guest_nickname
     FROM battle_rooms r
     LEFT JOIN users uo ON uo.id = r.owner_user_id
     LEFT JOIN users ug ON ug.id = r.guest_user_id
     WHERE r.status IN ('waiting','ready_check','deploy','playing')`
  );

  const playingUserIds = new Set<number>();
  for (const r of roomRows) {
    if (r.owner_user_id) playingUserIds.add(Number(r.owner_user_id));
    if (r.guest_user_id) playingUserIds.add(Number(r.guest_user_id));
  }

  return {
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      nickname: r.nickname,
      coins: Number(r.coins) || 0,
      cardCount: Number(r.card_count) || 0,
      lastActiveAt: Number(r.last_active_at) || null,
      inBattle: playingUserIds.has(Number(r.id)),
    })),
    rooms: roomRows.map((r) => ({
      id: r.room_id,
      status: r.status,
      bet: Number(r.bet) || 0,
      owner: { id: r.owner_user_id, nickname: r.owner_nickname },
      guest: r.guest_user_id ? { id: r.guest_user_id, nickname: r.guest_nickname } : null,
    })),
  };
}
