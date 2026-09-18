import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import crypto from 'crypto';
import { config } from '../config';
import { pool } from '../db/pool';
import { UserRow } from '../types';
import { signToken } from '../utils/jwt';

// ============ 密码哈希 (scrypt, 无需额外依赖) ============
const KEY_LEN = 64;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  // 恒定时间比较
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 用户名合法：字母数字下划线，4-20 位
const USERNAME_RE = /^[a-zA-Z0-9_]{4,20}$/;

function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

function isValidPassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 6 && password.length <= 64;
}

// ============ 微信 / 游客 ============
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

async function createOrGetUserByOpenid(
  openid: string,
  profile?: { nickname?: string; avatar_url?: string }
) {
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
  return userId;
}

/** 微信登录 (小程序环境调用) */
export async function loginByWxCode(code: string, profile?: { nickname?: string; avatar_url?: string }) {
  const openid = await wxCodeToOpenid(code);
  const userId = await createOrGetUserByOpenid(openid, profile);
  const token = signToken({ userId, openid });
  const user = await getUserById(userId);
  return { token, user };
}

// ============ 账号密码 ============
/** 用户名 + 密码注册 */
export async function registerByAccount(data: {
  username: string;
  password: string;
  nickname?: string;
}) {
  const username = (data.username || '').trim();
  const password = data.password || '';
  const nickname = (data.nickname || '').trim() || username;

  if (!isValidUsername(username)) {
    throw new Error('用户名需为 4-20 位字母、数字或下划线');
  }
  if (!isValidPassword(password)) {
    throw new Error('密码长度需为 6-64 位');
  }

  // 用户名唯一性检查
  const [dup] = await pool.execute<UserRow[]>(
    'SELECT id FROM users WHERE username = ?',
    [username]
  );
  if (dup[0]) throw new Error('用户名已被占用');

  const passwordHash = hashPassword(password);
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO users (openid, username, password_hash, nickname) VALUES (?, ?, ?, ?)',
    [`acct_${username}`, username, passwordHash, nickname]
  );
  const userId = result.insertId;

  const token = signToken({ userId, openid: `acct_${username}` });
  const user = await getUserById(userId);
  return { token, user };
}

/** 用户名 + 密码登录 */
export async function loginByAccount(username: string, password: string) {
  const uname = (username || '').trim();
  if (!uname || !password) throw new Error('请输入用户名和密码');

  const [rows] = await pool.execute<UserRow[]>(
    'SELECT * FROM users WHERE username = ?',
    [uname]
  );
  const userRow = rows[0];
  if (!userRow || !userRow.password_hash) {
    throw new Error('用户名或密码错误');
  }
  if (!verifyPassword(password, userRow.password_hash)) {
    throw new Error('用户名或密码错误');
  }

  const token = signToken({ userId: userRow.id, openid: userRow.openid });
  const user = await getUserById(userRow.id);
  return { token, user };
}

// ============ 通用 ============
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
    // 注意：必须带上 is_admin / is_banned，后台登录页要靠它判断权限
    'SELECT id, openid, username, nickname, avatar_url, coins, is_admin, is_banned, created_at FROM users WHERE id = ?',
    [userId]
  );
  const row = rows[0] as (UserRow & { is_admin?: number; is_banned?: number }) | undefined;
  if (!row) return null;
  // 归一化为布尔，前端只认 isAdmin / isBanned
  return {
    ...row,
    is_admin: undefined,
    is_banned: undefined,
    isAdmin: row.is_admin === 1,
    isBanned: row.is_banned === 1,
  };
}
