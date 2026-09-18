import { Router, Request, Response } from 'express';
import {
  loginByWxCode,
  loginByAccount,
  registerByAccount,
  getUserById,
  updateUserProfile,
} from '../services/authService';
import { getRepeatSettings, updateRepeatSettings } from '../services/repeatSettings';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';
import { config } from '../config';

const router = Router();

/**
 * 登录（自动路由）：
 *  - body 带 code  → 微信登录（含开发 dev_mock 游客）
 *  - body 带 username + password → 账号密码登录
 */
router.post('/login', async (req: Request, res: Response) => {
  const { code, username, password, nickname, avatar_url } = req.body;
  try {
    if (username !== undefined || password !== undefined) {
      // 账号密码登录
      try {
        const data = await loginByAccount(username, password);
        return ok(res, data, '登录成功');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '登录失败';
        // 用户名或密码错误 → 401，其余 → 400
        fail(res, msg === '用户名或密码错误' ? 401 : 400, msg);
        return;
      }
    }
    if (code === undefined) {
      return fail(res, 400, '缺少登录参数：请提供 code 或 username/password');
    }
    // 生产环境（devMockWx=false）时，禁止空/游客 code 匿名进入
    if (!config.devMockWx && (!code || code === 'dev_mock')) {
      return fail(res, 400, '请使用微信或账号登录');
    }
    const data = await loginByWxCode(code, { nickname, avatar_url });
    ok(res, data, '登录成功');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '登录失败';
    fail(res, msg === '用户名或密码错误' ? 401 : 500, msg);
  }
});

/** 账号密码注册（注册成功即自动登录） */
router.post('/register', async (req: Request, res: Response) => {
  const { username, password, nickname } = req.body || {};
  if (!username || !password) {
    return fail(res, 400, '请输入用户名和密码');
  }
  try {
    const data = await registerByAccount({ username, password, nickname });
    ok(res, data, '注册成功');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '注册失败';
    // 用户名被占用属于业务冲突，返回 409；其它非法参数 400
    const code = msg.includes('已被占用') ? 409 : msg === '用户名或密码错误' ? 401 : 400;
    fail(res, code, msg);
  }
});

/** 退出登录：前端清 token 即可，此接口兜底（预留） */
router.post('/logout', (_req: Request, res: Response) => {
  ok(res, null, '已退出登录');
});

router.get('/profile', authMiddleware, async (req: Request, res: Response) => {
  const user = await getUserById(req.userId!);
  if (!user) return fail(res, 404, '用户不存在');
  // 带上「重复拼写次数」设置，前台「我的」页面要用
  const repeat = await getRepeatSettings(req.userId!);
  ok(res, { ...user, repeat });
});

/**
 * 更新重复拼写次数设置
 * body: { catchRepeat?: number|null, feedRepeat?: number|null }
 * 传 null = 恢复默认
 */
router.put('/repeat-settings', authMiddleware, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const patch: { catchRepeat?: number | null; feedRepeat?: number | null } = {};
    if (body.catchRepeat !== undefined) {
      patch.catchRepeat = body.catchRepeat === null || body.catchRepeat === '' ? null : Number(body.catchRepeat);
    }
    if (body.feedRepeat !== undefined) {
      patch.feedRepeat = body.feedRepeat === null || body.feedRepeat === '' ? null : Number(body.feedRepeat);
    }
    if (!Object.keys(patch).length) return fail(res, 400, '没有要更新的设置');
    const repeat = await updateRepeatSettings(req.userId!, patch);
    ok(res, repeat, '设置已保存');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '保存失败');
  }
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
