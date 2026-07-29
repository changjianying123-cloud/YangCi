import { Router, Request, Response } from 'express';
import { listUserCards, getCardDetail, feedCard, getPendingFeedCards, getCardCount, hatchEgg } from '../services/cardService';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';

const router = Router();

router.get('/list', authMiddleware, async (req: Request, res: Response) => {
  const data = await listUserCards(req.userId!);
  ok(res, data);
});

router.get('/pending', authMiddleware, async (req: Request, res: Response) => {
  const data = await getPendingFeedCards(req.userId!);
  ok(res, data);
});

router.get('/count', authMiddleware, async (req: Request, res: Response) => {
  const count = await getCardCount(req.userId!);
  ok(res, { count });
});

router.get('/:cardId', authMiddleware, async (req: Request, res: Response) => {
  const card = await getCardDetail(req.userId!, Number(req.params.cardId));
  if (!card) return fail(res, 404, '卡牌不存在');
  ok(res, card);
});

router.post('/:cardId/feed', authMiddleware, async (req: Request, res: Response) => {
  const { spell_correct } = req.body;
  try {
    const data = await feedCard(req.userId!, Number(req.params.cardId), !!spell_correct);
    ok(res, data, data.done ? '喂养成功' : '继续努力');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '喂养失败');
  }
});

router.post('/:cardId/hatch', authMiddleware, async (req: Request, res: Response) => {
  try {
    const card = await hatchEgg(req.userId!, Number(req.params.cardId));
    ok(res, card, '孵化成功');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '孵化失败');
  }
});

export default router;
