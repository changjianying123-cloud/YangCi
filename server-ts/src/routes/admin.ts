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
      order: req.query.order === 'desc' ? 'desc' : 'asc',
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

// ==================== 单词导入 / 导出 ====================
// ⚠️ 必须在 /words/:id 之前注册，否则 /words/export 会被当成 id 匹配掉

router.get('/words/export', async (req: Request, res: Response) => {
  try {
    const idsParam = (req.query.ids as string) || '';
    const ids = idsParam
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    const { csv, count } = await svc.adminExportWords({
      ids: ids.length ? ids : undefined,
      bookCode: (req.query.bookCode as string) || undefined,
      keyword: (req.query.keyword as string) || undefined,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="words_${stamp}.csv"`);
    await logAdminAction(req.userId!, 'word.export', 'word', null, { count, ids: ids.length }, clientIp(req));
    // 用 Buffer 发送，确保 UTF-8 BOM 不被改写
    res.send(Buffer.from(csv, 'utf8'));
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '导出失败');
  }
});

router.get('/words/import-template', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="words_template.csv"');
  res.send(Buffer.from(svc.adminWordImportTemplate(), 'utf8'));
});

router.post('/words/import', async (req: Request, res: Response) => {
  try {
    const csv = String(req.body.csv || '');
    if (!csv.trim()) return fail(res, 400, '请提供 CSV 内容');
    const mode = req.body.mode === 'upsert' ? 'upsert' : 'append';
    const r = await svc.adminImportWords(csv, mode);
    await logAdminAction(req.userId!, 'word.import', 'word', null, r, clientIp(req));
    ok(res, r, `导入完成：新增 ${r.inserted}，更新 ${r.updated}，跳过 ${r.skipped}`);
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '导入失败');
  }
});

// ==================== 单词助记（一个单词可多个） ====================

router.get('/words/:id/mnemonics', async (req: Request, res: Response) => {
  try {
    ok(res, await svc.adminListMnemonics(Number(req.params.id)));
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取助记失败');
  }
});

router.post('/words/:id/mnemonics', async (req: Request, res: Response) => {
  const wordId = Number(req.params.id);
  try {
    const item = await svc.adminCreateMnemonic({
      wordId,
      title: req.body.title,
      imageUrl: req.body.imageUrl,
      content: req.body.content,
      sort: req.body.sort !== undefined ? Number(req.body.sort) : undefined,
    });
    await logAdminAction(req.userId!, 'mnemonic.create', 'word', wordId, { mnemonicId: item.id }, clientIp(req));
    ok(res, item, '新增成功');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '新增失败');
  }
});

router.put('/mnemonics/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const r = await svc.adminUpdateMnemonic(id, {
      title: req.body.title,
      imageUrl: req.body.imageUrl,
      content: req.body.content,
      sort: req.body.sort !== undefined ? Number(req.body.sort) : undefined,
    });
    await logAdminAction(req.userId!, 'mnemonic.update', 'mnemonic', id, req.body, clientIp(req));
    ok(res, r, '保存成功');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '保存失败');
  }
});

router.delete('/mnemonics/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const r = await svc.adminDeleteMnemonic(id);
    await logAdminAction(req.userId!, 'mnemonic.delete', 'mnemonic', id, null, clientIp(req));
    ok(res, r, '已删除');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '删除失败');
  }
});

/** 隐藏 / 恢复用户发布的助记（审核用，不物理删除） */
router.post('/mnemonics/:id/status', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const status = Number(req.body.status) === 1 ? 1 : 0;
  try {
    const r = await svc.adminSetMnemonicStatus(id, status);
    await logAdminAction(
      req.userId!,
      status === 1 ? 'mnemonic.unhide' : 'mnemonic.hide',
      'mnemonic',
      id,
      { status },
      clientIp(req)
    );
    ok(res, r, status === 1 ? '已恢复显示' : '已隐藏');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '操作失败');
  }
});

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
