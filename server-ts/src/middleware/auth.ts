import { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../utils/jwt';
import { fail } from '../utils/response';
import { touchLastActive } from '../utils/activity';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return fail(res, 401, '未登录或 token 无效');
  }
  const payload = verifyToken(token);
  if (!payload) {
    return fail(res, 401, '登录已过期，请重新登录');
  }
  req.userId = payload.userId;
  touchLastActive(payload.userId);
  next();
}
