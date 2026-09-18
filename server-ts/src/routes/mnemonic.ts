import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';
import {
  listMnemonics,
  createUserMnemonic,
  updateUserMnemonic,
  deleteUserMnemonic,
  toggleMnemonicLike,
  listMnemonicsForCards,
} from '../services/mnemonicService';

const router = Router();

// 全部需要登录（用户助记互相可见，但要登录才能看到和点赞）
router.use(authMiddleware);

/**
 * 批量取助记（收服/喂养时预加载用）
 * POST /api/mnemonic/batch  { wordIds: [1,2,3] }
 * ⚠️ 必须注册在 /:wordId 之前
 */
router.post('/batch', async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.wordIds) ? req.body.wordIds.map(Number) : [];
  if (!ids.length) return ok(res, {});
  try {
    ok(res, await listMnemonicsForCards(req.userId!, ids));
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取助记失败');
  }
});

/** 查某单词的全部可见助记 */
router.get('/word/:wordId', async (req: Request, res: Response) => {
  try {
    ok(res, await listMnemonics(req.userId!, Number(req.params.wordId)));
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '获取助记失败');
  }
});

/** 发布自己的助记 */
router.post('/word/:wordId', async (req: Request, res: Response) => {
  try {
    const item = await createUserMnemonic(req.userId!, Number(req.params.wordId), {
      imageUrl: req.body.imageUrl,
      content: req.body.content,
    });
    ok(res, item, '发布成功');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '发布失败');
  }
});

/** 编辑自己的助记 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const item = await updateUserMnemonic(req.userId!, Number(req.params.id), {
      imageUrl: req.body.imageUrl,
      content: req.body.content,
    });
    ok(res, item, '已保存');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '保存失败');
  }
});

/** 删除自己的助记 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const r = await deleteUserMnemonic(req.userId!, Number(req.params.id));
    ok(res, r, '已删除');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '删除失败');
  }
});

/** 点赞 / 取消点赞（切换） */
router.post('/:id/like', async (req: Request, res: Response) => {
  try {
    const r = await toggleMnemonicLike(req.userId!, Number(req.params.id));
    ok(res, r, r.liked ? '已点赞' : '已取消点赞');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '操作失败');
  }
});

export default router;
