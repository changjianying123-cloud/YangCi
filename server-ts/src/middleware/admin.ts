import { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../utils/jwt';
import { fail } from '../utils/response';
import { touchLastActive } from '../utils/activity';
import { pool } from '../db/pool';
import { RowDataPacket } from 'mysql2/promise';

/**
 * 管理员鉴权中间件。
 * 先验 token（拿到 userId），再查库确认该用户 is_admin=1 且未被封禁。
 * 不依赖前端隐藏——所有 /api/admin/* 接口都挂这个中间件。
 */
export async function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return fail(res, 401, '未登录或 token 无效');
  }
  const payload = verifyToken(token);
  if (!payload) {
    return fail(res, 401, '登录已过期，请重新登录');
  }

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, is_admin, is_banned FROM users WHERE id = ?',
      [payload.userId]
    );
    const u = rows[0];
    if (!u) return fail(res, 401, '用户不存在');
    if (u.is_banned === 1) return fail(res, 403, '账号已被封禁');
    if (u.is_admin !== 1) return fail(res, 403, '无管理员权限');
    req.userId = payload.userId;
    req.adminId = payload.userId;
    touchLastActive(payload.userId);
    next();
  } catch (err) {
    return fail(res, 500, '鉴权失败');
  }
}
