import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db/pool';
import { UserRow } from '../types';
import { signToken } from '../utils/jwt';

async function wxCodeToOpenid(code: string): Promise<string> {
  if (config.devMockWx || !config.wx.appId) {
    return `mock_${code || 'dev_user'}`;
  }
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wx.appId}&secret=${config.wx.secret}&js_code=${code}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = (await res.json()) as { openid?: string; errcode?: number; errmsg?: string };
  if (!data.openid) {
    throw new Error(data.errmsg || '微信登录失败');
  }
  return data.openid;
}

export async function loginByWxCode(code: string, profile?: { nickname?: string; avatar_url?: string }) {
  const openid = await wxCodeToOpenid(code);
  const [rows] = await pool.execute<UserRow[]>(
    'SELECT * FROM users WHERE openid = ?',
    [openid]
  );

  let userId: number;
  if (rows[0]) {
    userId = rows[0].id;
    if (profile?.nickname || profile?.avatar_url) {
      await pool.execute(
        'UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url) WHERE id = ?',
        [profile.nickname || null, profile.avatar_url || null, userId]
      );
    }
  } else {
    const [result] = await pool.execute<ResultSetHeader>(
      'INSERT INTO users (openid, nickname, avatar_url) VALUES (?, ?, ?)',
      [openid, profile?.nickname || '单词训练师', profile?.avatar_url || null]
    );
    userId = result.insertId;
  }

  const token = signToken({ userId, openid });
  const [userRows] = await pool.execute<UserRow[]>(
    'SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE id = ?',
    [userId]
  );

  return { token, user: userRows[0] };
}

export async function updateUserProfile(
  userId: number,
  data: { nickname?: string; avatar_url?: string }
) {
  await pool.execute(
    'UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url) WHERE id = ?',
    [data.nickname || null, data.avatar_url || null, userId]
  );
  return getUserById(userId);
}

export async function getUserById(userId: number) {
  const [rows] = await pool.execute<UserRow[]>(
    'SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE id = ?',
    [userId]
  );
  return rows[0] || null;
}
