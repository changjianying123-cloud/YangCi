import { Router, Request, Response } from 'express';
import {
  listUserCards,
  getCardDetail,
  feedCard,
  getPendingFeedCards,
  getCardCount,
  hatchEgg,
  abandonCard,
  recoverHunger,
  getPlayQuestion,
  playCard,
  pickRandomPlayableCard,
} from '../services/cardService';
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

// 随机另一张可玩的卡（“继续玩耍”换单词用）
// mood=sad|none|happy 时，只在所选心情范围内换词（与列表筛选一致）
// ⚠️ 必须在 /:cardId 之前注册，否则会被当成 cardId
router.get('/play/random', authMiddleware, async (req: Request, res: Response) => {
  const exclude = req.query.exclude ? Number(req.query.exclude) : undefined;
  const moodRaw = typeof req.query.mood === 'string' ? req.query.mood : undefined;
  const mood = moodRaw === 'sad' || moodRaw === 'none' || moodRaw === 'happy' ? moodRaw : undefined;
  try {
    const data = await pickRandomPlayableCard(req.userId!, exclude, mood);
    if (!data) return fail(res, 404, '没有其它可玩耍的单词了');
    ok(res, data);
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '获取失败');
  }
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

    if (data.done) {
      ok(res, data, data.message || '喂养成功');
    } else if (!data.spellCorrect) {
      ok(res, data, data.message || '拼写错误');
    } else {
      ok(res, data, data.message || '继续努力');
    }
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

router.post('/:cardId/abandon', authMiddleware, async (req: Request, res: Response) => {
  try {
    await abandonCard(req.userId!, Number(req.params.cardId));
    ok(res, null, '已遗弃该单词');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '遗弃失败');
  }
});

router.post('/recover-hunger', authMiddleware, async (req: Request, res: Response) => {
  const { card_id } = req.body;
  if (!card_id) return fail(res, 400, '缺少 card_id');
  try {
    // 只恢复饥饿状态，不计入拼写进度（拼写必须靠真正拼对推进）
    const data = await recoverHunger(req.userId!, Number(card_id));
    ok(res, data, '饥饿恢复成功，开始喂养吧！');
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '恢复失败');
  }
});

// ===== 玩耍（英文选中文四选一）：答对提升心情，答错降低心情 =====

// 取题：mode=pick 返回 4 选项；mode=translate 只要英文（用户手打中文）
router.get('/:cardId/play', authMiddleware, async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode === 'translate' ? 'translate' : 'pick';
    const data = await getPlayQuestion(req.userId!, Number(req.params.cardId), mode);
    ok(res, data);
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '获取题目失败');
  }
});
// 交答案：mode=pick 严格匹配选项；mode=translate 容错匹配任意义项
router.post('/:cardId/play', authMiddleware, async (req: Request, res: Response) => {
  const { answer, mode } = req.body;
  try {
    const m = mode === 'translate' ? 'translate' : 'pick';
    const data = await playCard(req.userId!, Number(req.params.cardId), answer, m);
    ok(res, data, data.message);
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '玩耍失败');
  }
});

export default router;
