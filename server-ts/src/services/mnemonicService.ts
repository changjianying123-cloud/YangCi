import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../db/pool';
import { toMillis } from '../utils/time';

/**
 * 单词助记服务（前台用户端）
 *
 * 核心区分：
 *  - user_id IS NULL  → 官方助记（后台 admin 发布）
 *  - user_id 非空      → 用户自己发布的助记
 *
 * 可见性：官方助记 + 所有未被隐藏的用户助记（互相可见）
 */

export interface MnemonicDTO {
  id: number;
  wordId: number;
  imageUrl: string | null;
  content: string | null;
  sort: number;
  /** 是否官方助记 */
  isOfficial: boolean;
  /** 发布者昵称；官方为 null */
  authorName: string | null;
  authorId: number | null;
  likeCount: number;
  /** 当前登录用户是否已点赞 */
  liked: boolean;
  /** 是否是当前登录用户自己发布的（前端据此显示删除按钮） */
  isMine: boolean;
  createdAt: number | null;
}

interface Row extends RowDataPacket {
  id: number;
  word_id: number;
  title: string | null;
  image_url: string | null;
  content: string | null;
  sort: number;
  user_id: number | null;
  like_count: number;
  status: number;
  created_at: unknown;
  author_name?: string | null;
  liked?: number;
}

function mapRow(r: Row, viewerId: number): MnemonicDTO {
  return {
    id: r.id,
    wordId: r.word_id,
    imageUrl: r.image_url,
    content: r.content,
    sort: Number(r.sort) || 0,
    isOfficial: r.user_id === null || r.user_id === undefined,
    authorId: r.user_id ?? null,
    authorName: r.author_name || null,
    likeCount: Number(r.like_count) || 0,
    liked: Number(r.liked) > 0,
    isMine: r.user_id !== null && r.user_id !== undefined && Number(r.user_id) === viewerId,
    createdAt: toMillis(r.created_at),
  };
}

/**
 * 查某单词下所有可见助记。
 * 排序：官方优先 → 点赞多的优先 → sort → id
 */
export async function listMnemonics(userId: number, wordId: number): Promise<MnemonicDTO[]> {
  const [rows] = await pool.execute<Row[]>(
    `SELECT m.*, u.nickname AS author_name,
            (SELECT COUNT(*) FROM mnemonic_likes ml WHERE ml.mnemonic_id = m.id AND ml.user_id = ?) AS liked
     FROM word_mnemonics m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.word_id = ? AND m.status = 1
     ORDER BY (m.user_id IS NOT NULL) ASC, m.like_count DESC, m.sort ASC, m.id ASC`,
    [userId, wordId]
  );
  return rows.map((r) => mapRow(r, userId));
}

/** 查单词下的助记条数（用于列表角标，不区分官方/用户） */
export async function countMnemonics(wordId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS c FROM word_mnemonics WHERE word_id = ? AND status = 1',
    [wordId]
  );
  return Number((rows[0] as { c: number })?.c) || 0;
}

/** 用户发布自己的助记 */
export async function createUserMnemonic(
  userId: number,
  wordId: number,
  data: { imageUrl?: string | null; content?: string | null }
): Promise<MnemonicDTO> {
  if (!wordId) throw new Error('缺少单词 ID');
  const content = (data.content || '').trim();
  const imageUrl = (data.imageUrl || '').trim();
  if (!content && !imageUrl) throw new Error('助记内容与图片至少填一项');
  if (content.length > 2000) throw new Error('助记内容过长（最多 2000 字）');

  const [w] = await pool.execute<RowDataPacket[]>('SELECT id FROM words WHERE id = ?', [wordId]);
  if (!w[0]) throw new Error('单词不存在');

  // 防灌水：同一用户对同一单词最多 5 条
  const [cnt] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS c FROM word_mnemonics WHERE word_id = ? AND user_id = ?',
    [wordId, userId]
  );
  if (Number((cnt[0] as { c: number })?.c) >= 5) {
    throw new Error('同一个单词最多发布 5 条助记');
  }

  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO word_mnemonics (word_id, user_id, image_url, content, sort) VALUES (?, ?, ?, ?, 0)',
    [wordId, userId, imageUrl || null, content || null]
  );

  const list = await listMnemonics(userId, wordId);
  const created = list.find((m) => m.id === result.insertId);
  if (!created) throw new Error('创建后读取失败');
  return created;
}

/** 用户编辑自己的助记（只能改自己的、且非官方） */
export async function updateUserMnemonic(
  userId: number,
  mnemonicId: number,
  data: { imageUrl?: string | null; content?: string | null }
): Promise<MnemonicDTO> {
  const [rows] = await pool.execute<Row[]>(
    'SELECT * FROM word_mnemonics WHERE id = ?',
    [mnemonicId]
  );
  const cur = rows[0];
  if (!cur) throw new Error('助记不存在');
  if (cur.user_id === null || cur.user_id === undefined) throw new Error('官方助记不可编辑');
  if (Number(cur.user_id) !== userId) throw new Error('只能编辑自己发布的助记');

  const nextContent = data.content !== undefined ? (data.content || '').trim() : cur.content;
  const nextImage = data.imageUrl !== undefined ? (data.imageUrl || '').trim() : cur.image_url;
  if (!nextContent && !nextImage) throw new Error('助记内容与图片至少填一项');

  const sets: string[] = [];
  const params: any[] = [];
  if (data.imageUrl !== undefined) { sets.push('`image_url` = ?'); params.push(nextImage || null); }
  if (data.content !== undefined) { sets.push('`content` = ?'); params.push(nextContent || null); }
  if (!sets.length) throw new Error('没有要更新的内容');

  params.push(mnemonicId);
  await pool.execute(`UPDATE word_mnemonics SET ${sets.join(', ')} WHERE id = ?`, params);

  const list = await listMnemonics(userId, cur.word_id);
  const updated = list.find((m) => m.id === mnemonicId);
  if (!updated) throw new Error('更新后读取失败');
  return updated;
}

/** 用户删除自己的助记 */
export async function deleteUserMnemonic(userId: number, mnemonicId: number) {
  const [rows] = await pool.execute<Row[]>(
    'SELECT * FROM word_mnemonics WHERE id = ?',
    [mnemonicId]
  );
  const cur = rows[0];
  if (!cur) throw new Error('助记不存在');
  if (cur.user_id === null || cur.user_id === undefined) throw new Error('官方助记不可删除');
  if (Number(cur.user_id) !== userId) throw new Error('只能删除自己发布的助记');

  // 点赞记录一并清掉
  await pool.execute('DELETE FROM mnemonic_likes WHERE mnemonic_id = ?', [mnemonicId]);
  await pool.execute('DELETE FROM word_mnemonics WHERE id = ?', [mnemonicId]);
  return { deleted: true };
}

/**
 * 点赞 / 取消点赞（切换）
 * 用 UNIQUE KEY 兜底并发重复点赞
 */
export async function toggleMnemonicLike(userId: number, mnemonicId: number) {
  const [rows] = await pool.execute<Row[]>('SELECT * FROM word_mnemonics WHERE id = ?', [mnemonicId]);
  const cur = rows[0];
  if (!cur) throw new Error('助记不存在');
  if (cur.status !== 1) throw new Error('该助记已不可见');

  const [exist] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM mnemonic_likes WHERE mnemonic_id = ? AND user_id = ?',
    [mnemonicId, userId]
  );

  if (exist[0]) {
    await pool.execute('DELETE FROM mnemonic_likes WHERE mnemonic_id = ? AND user_id = ?', [mnemonicId, userId]);
    await pool.execute('UPDATE word_mnemonics SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?', [mnemonicId]);
  } else {
    await pool.execute('INSERT INTO mnemonic_likes (mnemonic_id, user_id) VALUES (?, ?)', [mnemonicId, userId]);
    await pool.execute('UPDATE word_mnemonics SET like_count = like_count + 1 WHERE id = ?', [mnemonicId]);
  }

  const [after] = await pool.execute<RowDataPacket[]>(
    'SELECT like_count FROM word_mnemonics WHERE id = ?',
    [mnemonicId]
  );
  const likeCount = Number((after[0] as { like_count: number })?.like_count) || 0;
  return { liked: !exist[0], likeCount };
}

/**
 * 按 word_id 批量取助记，用于收服/喂养时预加载（避免每翻一个词都请求一次）
 */
export async function listMnemonicsForCards(
  userId: number,
  wordIds: number[]
): Promise<Record<number, MnemonicDTO[]>> {
  const out: Record<number, MnemonicDTO[]> = {};
  const ids = Array.from(new Set(wordIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (!ids.length) return out;

  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.execute<Row[]>(
    `SELECT m.*, u.nickname AS author_name,
            (SELECT COUNT(*) FROM mnemonic_likes ml WHERE ml.mnemonic_id = m.id AND ml.user_id = ?) AS liked
     FROM word_mnemonics m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.word_id IN (${placeholders}) AND m.status = 1
     ORDER BY (m.user_id IS NOT NULL) ASC, m.like_count DESC, m.sort ASC, m.id ASC`,
    [userId, ...ids]
  );
  for (const r of rows) {
    if (!out[r.word_id]) out[r.word_id] = [];
    out[r.word_id].push(mapRow(r, userId));
  }
  return out;
}
