import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool';
import { config } from '../config';

/**
 * 用户自定义「重复拼写次数」
 *
 * 背景：收服（拼对 N 次才算收服）和喂养（拼对 N 次才算喂一次）
 * 的重复次数以前是写死的全局配置。有的用户觉得太枯燥，有的觉得不够，
 * 所以允许每个用户自己调，NULL 表示沿用全局默认。
 *
 * 取值范围：收服 1~20，喂养 1~10。超过范围一律夹到边界，
 * 避免用户填 999 把界面卡死、或填 0 导致逻辑死循环。
 */

export const CATCH_REPEAT_MIN = 1;
export const CATCH_REPEAT_MAX = 20;
export const FEED_REPEAT_MIN = 1;
export const FEED_REPEAT_MAX = 10;

export function clampCatchRepeat(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return config.card.catchRequiredCorrect;
  return Math.min(CATCH_REPEAT_MAX, Math.max(CATCH_REPEAT_MIN, n));
}

export function clampFeedRepeat(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return config.card.feedSpellCount || 3;
  return Math.min(FEED_REPEAT_MAX, Math.max(FEED_REPEAT_MIN, n));
}

/** 某用户实际生效的重复次数设置（含默认值） */
export interface RepeatSettings {
  catchRepeat: number;
  feedRepeat: number;
  /** 全局默认，便于前端展示「默认」标识 */
  defaultCatchRepeat: number;
  defaultFeedRepeat: number;
  catchMin: number;
  catchMax: number;
  feedMin: number;
  feedMax: number;
}

export async function getRepeatSettings(userId: number): Promise<RepeatSettings> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT catch_repeat, feed_repeat FROM users WHERE id = ?',
    [userId]
  );
  const r = rows[0] || {};
  return {
    catchRepeat: r.catch_repeat === null || r.catch_repeat === undefined
      ? config.card.catchRequiredCorrect
      : clampCatchRepeat(r.catch_repeat),
    feedRepeat: r.feed_repeat === null || r.feed_repeat === undefined
      ? config.card.feedSpellCount || 3
      : clampFeedRepeat(r.feed_repeat),
    defaultCatchRepeat: config.card.catchRequiredCorrect,
    defaultFeedRepeat: config.card.feedSpellCount || 3,
    catchMin: CATCH_REPEAT_MIN,
    catchMax: CATCH_REPEAT_MAX,
    feedMin: FEED_REPEAT_MIN,
    feedMax: FEED_REPEAT_MAX,
  };
}

/** 只要收服次数（热路径用，少查两列） */
export async function getUserCatchRepeat(userId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT catch_repeat FROM users WHERE id = ?',
    [userId]
  );
  const v = rows[0]?.catch_repeat;
  return v === null || v === undefined ? config.card.catchRequiredCorrect : clampCatchRepeat(v);
}

/** 只要喂养次数（热路径用） */
export async function getUserFeedRepeat(userId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT feed_repeat FROM users WHERE id = ?',
    [userId]
  );
  const v = rows[0]?.feed_repeat;
  return v === null || v === undefined ? config.card.feedSpellCount || 3 : clampFeedRepeat(v);
}

/** 更新用户设置（null = 恢复默认） */
export async function updateRepeatSettings(
  userId: number,
  data: { catchRepeat?: number | null; feedRepeat?: number | null }
): Promise<RepeatSettings> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.catchRepeat !== undefined) {
    sets.push('`catch_repeat` = ?');
    params.push(data.catchRepeat === null ? null : clampCatchRepeat(data.catchRepeat));
  }
  if (data.feedRepeat !== undefined) {
    sets.push('`feed_repeat` = ?');
    params.push(data.feedRepeat === null ? null : clampFeedRepeat(data.feedRepeat));
  }

  if (sets.length) {
    params.push(userId);
    await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getRepeatSettings(userId);
}
