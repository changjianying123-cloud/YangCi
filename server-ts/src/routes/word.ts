import { Router, Request, Response } from 'express';
import { getRandomWord, catchWord, checkCatchProgress, getWordDetail, checkCatchable } from '../services/wordService';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';
import { pool } from '../db/pool';

const router = Router();

router.get('/random', authMiddleware, async (req: Request, res: Response) => {
  const bookCode = req.query.book_code as string;
  if (!bookCode) return fail(res, 400, '缺少 book_code 参数');
  const word = await getRandomWord(req.userId!, bookCode);
  if (!word) return ok(res, null, '该词书暂无可收服单词');
  ok(res, word);
});

router.post('/catch', authMiddleware, async (req: Request, res: Response) => {
  const { word_id, correct_count } = req.body;
  if (!word_id) return fail(res, 400, '缺少 word_id');

  try {
    if (typeof correct_count === 'number') {
      const result = await checkCatchProgress(req.userId!, word_id, correct_count);
      return ok(res, result, result.captured ? '收服成功' : '继续练习');
    }
    const result = await catchWord(req.userId!, word_id, 0);
    ok(res, result, '收服成功');
  } catch (err: unknown) {
    fail(res, 409, err instanceof Error ? err.message : '收服失败');
  }
});

router.post('/batch-catch', authMiddleware, async (req: Request, res: Response) => {
  const { word_ids } = req.body;
  if (!word_ids || !Array.isArray(word_ids) || word_ids.length === 0) {
    return fail(res, 400, '缺少 word_ids');
  }
  try {
    let totalCoinReward = 0;
    const results = [];
    for (const wordId of word_ids) {
      try {
        const result = await catchWord(req.userId!, wordId, 6);
        totalCoinReward += result.coinReward;
        results.push(result);
      } catch (e) {
        // 单个词失败不拖垮整批（如单词不存在等），记录并继续
        results.push({ wordId, error: e instanceof Error ? e.message : '收服失败' });
      }
    }
    // 满 10 个额外奖励 20 金币
    const bonus = word_ids.length >= 10 ? 20 : 0;
    if (bonus > 0) {
      await pool.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [bonus, req.userId!]);
      totalCoinReward += bonus;
    }
    ok(res, { results, totalCoinReward, bonus });
  } catch (err: unknown) {
    fail(res, 409, err instanceof Error ? err.message : '批量收服失败');
  }
});

router.post('/check-catchable', authMiddleware, async (req: Request, res: Response) => {
  const { word_id } = req.body;
  if (!word_id) return fail(res, 400, '缺少 word_id');
  const result = await checkCatchable(req.userId!, word_id);
  ok(res, result);
});

router.get('/:wordId', authMiddleware, async (req: Request, res: Response) => {
  const word = await getWordDetail(Number(req.params.wordId));
  if (!word) return fail(res, 404, '单词不存在');
  ok(res, word);
});

export default router;
