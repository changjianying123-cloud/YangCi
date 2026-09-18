import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool';
import crypto from 'crypto';
import { onlineCount } from '../ws/hub';
import { toMillis } from '../utils/time';

// ==================== 单词管理 ====================

export async function adminListWords(opts: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  bookCode?: string;
  /** 排序方向：默认 ASC（id 正序）；desc 为倒序 */
  order?: 'asc' | 'desc';
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

  const orderDir = opts.order === 'desc' ? 'DESC' : 'ASC';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT w.*, b.book_code, b.book_name,
            (SELECT COUNT(*) FROM user_cards uc WHERE uc.word_id = w.id) AS captured_count,
            (SELECT COUNT(*) FROM word_mnemonics wm WHERE wm.word_id = w.id) AS mnemonic_count
     FROM words w
     JOIN books b ON b.id = w.book_id
     ${whereSql}
     ORDER BY w.id ${orderDir}
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
      mnemonicCount: Number(r.mnemonic_count) || 0,
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
  // 助记表也一并清掉（含点赞记录），避免残留孤儿数据
  await pool.execute(
    'DELETE ml FROM mnemonic_likes ml JOIN word_mnemonics wm ON wm.id = ml.mnemonic_id WHERE wm.word_id = ?',
    [wordId]
  );
  await pool.execute('DELETE FROM word_mnemonics WHERE word_id = ?', [wordId]);
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
    // ⚠️ battles.status='active' 不可信：
    //    战斗状态只在玩家「主动操作」时才 saveBattle 落库，
    //    开了局就退出 App 的会永久卡在 active（历史残留，见 memories）。
    //    因此以 turn_deadline（回合截止毫秒）判断：只统计还有人在打的。
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' AND turn_deadline >= ? THEN 1 ELSE 0 END) AS ongoing,
            SUM(CASE WHEN status = 'active' AND (turn_deadline IS NULL OR turn_deadline < ?) THEN 1 ELSE 0 END) AS stale
     FROM battles`,
    [Date.now(), Date.now()]
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
      stale: Number(bsr.stale) || 0,
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

// ==================== 单词助记（一个单词可多个） ====================

function mapMnemonic(r: any) {
  const isOfficial = r.user_id === null || r.user_id === undefined;
  return {
    id: r.id,
    wordId: r.word_id,
    title: null,
    imageUrl: r.image_url,
    content: r.content,
    sort: Number(r.sort) || 0,
    // 官方助记 = user_id 为 NULL（后台发布）；否则是用户于小程序发布的
    isOfficial,
    authorId: r.user_id ?? null,
    authorName: r.author_name || null,
    likeCount: Number(r.like_count) || 0,
    status: Number(r.status ?? 1),
    createdAt: toMillis(r.created_at),
    updatedAt: toMillis(r.updated_at),
  };
}

/** 查某单词下的全部助记（官方 + 用户发布，供后台审核/查看） */
export async function adminListMnemonics(wordId: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT m.*, u.nickname AS author_name
     FROM word_mnemonics m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.word_id = ?
     ORDER BY (m.user_id IS NOT NULL) ASC, m.sort ASC, m.id ASC`,
    [wordId]
  );
  return rows.map(mapMnemonic);
}

export async function adminCreateMnemonic(data: {
  wordId: number;
  imageUrl?: string | null;
  content?: string | null;
  sort?: number;
}) {
  if (!data.wordId) throw new Error('缺少单词 ID');
  const content = (data.content || '').trim();
  const imageUrl = (data.imageUrl || '').trim();
  if (!content && !imageUrl) throw new Error('助记内容与图片至少填一项');

  const [w] = await pool.execute<RowDataPacket[]>('SELECT id FROM words WHERE id = ?', [data.wordId]);
  if (!w[0]) throw new Error('单词不存在');

  const [result] = await pool.execute<ResultSetHeader>(
    // user_id 不传 → 保持 NULL，即「官方助记」
    'INSERT INTO word_mnemonics (word_id, image_url, content, sort) VALUES (?, ?, ?, ?)',
    [data.wordId, imageUrl || null, content || null, data.sort ?? 0]
  );
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM word_mnemonics WHERE id = ?', [result.insertId]);
  return mapMnemonic(rows[0]);
}

/**
 * 后台编辑助记。
 * ⚠️ 用户自己发布的助记（user_id 非空）不允许后台改内容——
 *    那是用户的原创内容，后台只该管可见性（hide/unhide）。
 */
export async function adminUpdateMnemonic(
  id: number,
  data: { imageUrl?: string | null; content?: string | null; sort?: number }
) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM word_mnemonics WHERE id = ?', [id]);
  if (!rows[0]) throw new Error('助记不存在');
  if (rows[0].user_id !== null && rows[0].user_id !== undefined) {
    throw new Error('用户发布的助记不可编辑内容，只能隐藏/恢复');
  }

  const sets: string[] = [];
  const params: any[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`\`${col}\` = ?`);
    params.push(val);
  };
  if (data.imageUrl !== undefined) put('image_url', data.imageUrl || null);
  if (data.content !== undefined) put('content', data.content);
  if (data.sort !== undefined) put('sort', data.sort);

  if (!sets.length) return { updated: false };
  params.push(id);
  await pool.execute(`UPDATE word_mnemonics SET ${sets.join(', ')} WHERE id = ?`, params);
  const [after] = await pool.execute<RowDataPacket[]>('SELECT * FROM word_mnemonics WHERE id = ?', [id]);
  return { updated: true, item: mapMnemonic(after[0]) };
}

/**
 * 隐藏 / 恢复一条助记（对用户发布的助记做审核，不物理删除）
 * status: 1 正常，0 隐藏
 */
export async function adminSetMnemonicStatus(id: number, status: 0 | 1) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM word_mnemonics WHERE id = ?', [id]);
  if (!rows[0]) throw new Error('助记不存在');
  await pool.execute('UPDATE word_mnemonics SET status = ? WHERE id = ?', [status, id]);
  return { id, status };
}

export async function adminDeleteMnemonic(id: number) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM word_mnemonics WHERE id = ?', [id]);
  if (!rows[0]) throw new Error('助记不存在');
  await pool.execute('DELETE FROM mnemonic_likes WHERE mnemonic_id = ?', [id]);
  await pool.execute('DELETE FROM word_mnemonics WHERE id = ?', [id]);
  return { deleted: true };
}

// ==================== 单词导入 / 导出 ====================

const EXPORT_COLUMNS = ['word', 'phonetic', 'pos', 'meaning', 'example_sentence'];

/** CSV 单元格转义：含 , " \n 时用双引号包裹 */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 导出单词为 CSV 文本。
 * 传 ids 只导这些；传 bookCode 导整本；都不传导出全部。
 */
export async function adminExportWords(opts: { ids?: number[]; bookCode?: string; keyword?: string } = {}) {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.ids && opts.ids.length) {
    where.push(`w.id IN (${opts.ids.map(() => '?').join(',')})`);
    params.push(...opts.ids);
  }
  if (opts.bookCode) {
    where.push('b.book_code = ?');
    params.push(opts.bookCode);
  }
  if (opts.keyword) {
    where.push('(w.word LIKE ? OR w.meaning LIKE ?)');
    params.push(`%${opts.keyword}%`, `%${opts.keyword}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT w.word, w.phonetic, w.pos, w.meaning, w.example_sentence, b.book_code, b.book_name
     FROM words w JOIN books b ON b.id = w.book_id
     ${whereSql}
     ORDER BY w.id ASC`,
    params
  );

  const header = ['book_code', ...EXPORT_COLUMNS].join(',');
  const lines = rows.map((r) =>
    [r.book_code, r.word, r.phonetic, r.pos, r.meaning, r.example_sentence].map(csvCell).join(',')
  );
  // 带 BOM，Excel 打开不乱码
  return { csv: '\uFEFF' + [header, ...lines].join('\r\n'), count: rows.length };
}

/** 生成导入模板（只有表头 + 一行示例） */
export function adminWordImportTemplate() {
  const header = ['book_code', ...EXPORT_COLUMNS].join(',');
  const sample = ['primary', 'apple', '/ˈæpl/', 'noun', '苹果', 'I ate an apple.'].map(csvCell).join(',');
  return '\uFEFF' + [header, sample].join('\r\n');
}

/** 解析 CSV（支持双引号包裹、转义引号、逗号/换行） */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (ch === '\r') {
      /* 跳过 CRLF 的 CR */
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * 导入单词（CSV 文本）。
 * 列：book_code, word, phonetic, pos, meaning, example_sentence
 * mode: append 追加（重名跳过）| upsert 覆盖（同词书同词则更新释义等）
 */
export async function adminImportWords(csvText: string, mode: 'append' | 'upsert' = 'append') {
  const table = parseCsv(csvText);
  if (!table.length) throw new Error('文件为空');

  const header = table[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iBook = idx('book_code');
  const iWord = idx('word');
  const iMeaning = idx('meaning');
  if (iBook < 0 || iWord < 0 || iMeaning < 0) {
    throw new Error('表头缺少必需列：book_code / word / meaning');
  }
  const iPhonetic = idx('phonetic');
  const iPos = idx('pos');
  const iExample = idx('example_sentence');

  const [bookRows] = await pool.execute<RowDataPacket[]>('SELECT id, book_code FROM books');
  const bookMap = new Map<string, number>();
  bookRows.forEach((b) => bookMap.set(String(b.book_code), Number(b.id)));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { row: number; reason: string }[] = [];
  const touchedBooks = new Set<number>();

  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const lineNo = i + 1;
    const get = (n: number) => (n >= 0 && n < r.length ? (r[n] || '').trim() : '');

    const bookCode = get(iBook);
    const word = get(iWord);
    const meaning = get(iMeaning);
    if (!bookCode || !word || !meaning) {
      errors.push({ row: lineNo, reason: 'book_code / word / meaning 有空值' });
      skipped++;
      continue;
    }
    const bookId = bookMap.get(bookCode);
    if (!bookId) {
      errors.push({ row: lineNo, reason: `词书不存在: ${bookCode}` });
      skipped++;
      continue;
    }

    const phonetic = get(iPhonetic) || null;
    const pos = get(iPos) || null;
    const example = get(iExample) || null;

    try {
      if (mode === 'upsert') {
        const [upd] = await pool.execute<ResultSetHeader>(
          `UPDATE words SET phonetic = ?, pos = ?, meaning = ?, example_sentence = ?
           WHERE book_id = ? AND word = ?`,
          [phonetic, pos, meaning, example, bookId, word]
        );
        if (upd.affectedRows > 0) { updated++; touchedBooks.add(bookId); continue; }
      }
      await pool.execute(
        `INSERT INTO words (book_id, word, phonetic, meaning, example_sentence, pos)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bookId, word, phonetic, meaning, example, pos]
      );
      inserted++;
      touchedBooks.add(bookId);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'ER_DUP_ENTRY') {
        errors.push({ row: lineNo, reason: `已存在: ${word}（追加模式跳过）` });
        skipped++;
      } else {
        errors.push({ row: lineNo, reason: e.code || '写入失败' });
        skipped++;
      }
    }
  }

  for (const bid of touchedBooks) await refreshBookWordCount(bid);

  return { inserted, updated, skipped, total: table.length - 1, errors: errors.slice(0, 50) };
}
