import { Router, Request, Response } from 'express';
import { adminMiddleware } from '../middleware/admin';
import { ok, fail } from '../utils/response';
import * as svc from '../services/adminService';
import { listAdminLogs, logAdminAction } from '../services/adminLogService';
import { verifyToken } from '../utils/jwt';
import { pool } from '../db/pool';
import { RowDataPacket } from 'mysql2/promise';

const router = Router();

function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',')[0] || req.socket.remoteAddress || '').trim();
}

// ⚠️ bootstrap 必须在 adminMiddleware 之前注册：
//    它的使用者正是「还不是管理员」的人（首个管理员初始化），
//    所以这里只验普通登录 token，不验管理员身份。
router.post('/bootstrap', async (req: Request, res: Response) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) return fail(res, 401, '未登录或 token 无效');
  try {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1');
    if (Number((rows[0] as { c: number })?.c) > 0) {
      return fail(res, 403, '已存在管理员，无法通过此接口提权');
    }
    await pool.execute('UPDATE users SET is_admin = 1 WHERE id = ?', [payload.userId]);
    await logAdminAction(payload.userId, 'admin.bootstrap', 'user', payload.userId, null, clientIp(req));
    ok(res, null, '已设为管理员');
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '操作失败');
  }
});

// 其余 /api/admin/* 一律先过管理员鉴权
router.use(adminMiddleware);

// ==================== 概览 / 统计 ====================

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const data = await svc.adminDashboard();
    ok(res, data);
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取概览失败');
  }
});

router.get('/stats/trend', async (req: Request, res: Response) => {
  try {
    const days = Number(req.query.days) || 14;
    ok(res, await svc.adminTrend(days));
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取趋势失败');
  }
});

router.get('/online', async (_req: Request, res: Response) => {
  try {
    ok(res, await svc.adminOnlineUsers());
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取在线用户失败');
  }
});

// ==================== 词书（下拉用） ====================

router.get('/books', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, book_code, book_name, icon, color, total_words FROM books ORDER BY id'
    );
    ok(res, rows);
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取词书失败');
  }
});

// ==================== 单词管理 ====================

router.get('/words', async (req: Request, res: Response) => {
  try {
    const data = await svc.adminListWords({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      keyword: (req.query.keyword as string) || undefined,
      bookCode: (req.query.bookCode as string) || undefined,
    });
    ok(res, data);
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取单词失败');
  }
});

router.post('/words', async (req: Request, res: Response) => {
  try {
    const r = await svc.adminCreateWord({
      bookId: Number(req.body.bookId),
      word: req.body.word,
      meaning: req.body.meaning,
      phonetic: req.body.phonetic,
      pos: req.body.pos,
      exampleSentence: req.body.exampleSentence,
      audioUrl: req.body.audioUrl,
    });
    await logAdminAction(req.userId!, 'word.create', 'word', r.id, req.body, clientIp(req));
    ok(res, r, '新增成功');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '新增失败');
  }
});

router.put('/words/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const r = await svc.adminUpdateWord(id, {
      bookId: req.body.bookId !== undefined ? Number(req.body.bookId) : undefined,
      word: req.body.word,
      meaning: req.body.meaning,
      phonetic: req.body.phonetic,
      pos: req.body.pos,
      exampleSentence: req.body.exampleSentence,
      audioUrl: req.body.audioUrl,
    });
    await logAdminAction(req.userId!, 'word.update', 'word', id, req.body, clientIp(req));
    ok(res, r, '保存成功');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '保存失败');
  }
});

router.delete('/words/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const r = await svc.adminDeleteWord(id);
    await logAdminAction(req.userId!, 'word.delete', 'word', id, r, clientIp(req));
    ok(res, r, `已删除（同时移除 ${r.removedCards} 张用户卡牌）`);
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '删除失败');
  }
});

// ==================== 用户管理 ====================

router.get('/users', async (req: Request, res: Response) => {
  try {
    const bannedRaw = req.query.banned;
    const data = await svc.adminListUsers({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      keyword: (req.query.keyword as string) || undefined,
      banned: bannedRaw === 'true' ? true : bannedRaw === 'false' ? false : undefined,
      adminOnly: req.query.adminOnly === 'true',
    });
    ok(res, data);
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取用户失败');
  }
});

router.get('/users/:id', async (req: Request, res: Response) => {
  try {
    ok(res, await svc.adminUserDetail(Number(req.params.id)));
  } catch (err: unknown) {
    fail(res, 404, err instanceof Error ? err.message : '获取用户详情失败');
  }
});

router.put('/users/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const r = await svc.adminUpdateUser(id, {
      nickname: req.body.nickname,
      coins: req.body.coins !== undefined ? Number(req.body.coins) : undefined,
      coinsDelta: req.body.coinsDelta !== undefined ? Number(req.body.coinsDelta) : undefined,
      isAdmin: req.body.isAdmin !== undefined ? !!req.body.isAdmin : undefined,
      isBanned: req.body.isBanned !== undefined ? !!req.body.isBanned : undefined,
    });
    await logAdminAction(req.userId!, 'user.update', 'user', id, req.body, clientIp(req));
    ok(res, r, '保存成功');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '保存失败');
  }
});

router.post('/users/:id/reset-password', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await svc.adminResetPassword(id, req.body.password);
    await logAdminAction(req.userId!, 'user.reset_password', 'user', id, null, clientIp(req));
    ok(res, null, '密码已重置');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '重置失败');
  }
});

// ==================== 操作日志 ====================

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const data = await listAdminLogs({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      action: (req.query.action as string) || undefined,
      adminId: req.query.adminId ? Number(req.query.adminId) : undefined,
    });
    ok(res, data);
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取日志失败');
  }
});

export default router;
