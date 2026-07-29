import { Router, Request, Response } from 'express';
import { loginByWxCode, getUserById, updateUserProfile } from '../services/authService';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { code, nickname, avatar_url } = req.body;
  if (!code) return fail(res, 400, '缺少微信 code');
  try {
    const data = await loginByWxCode(code, { nickname, avatar_url });
    ok(res, data, '登录成功');
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '登录失败');
  }
});

router.get('/profile', authMiddleware, async (req: Request, res: Response) => {
  const user = await getUserById(req.userId!);
  if (!user) return fail(res, 404, '用户不存在');
  ok(res, user);
});

router.put('/profile', authMiddleware, async (req: Request, res: Response) => {
  const { nickname, avatar_url } = req.body;
  if (!nickname && !avatar_url) {
    return fail(res, 400, '请提供 nickname 或 avatar_url');
  }
  const user = await updateUserProfile(req.userId!, { nickname, avatar_url });
  ok(res, user, '更新成功');
});

export default router;
