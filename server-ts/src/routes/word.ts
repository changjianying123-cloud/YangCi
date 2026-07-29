import { Router, Request, Response } from 'express';
import { getRandomWord, catchWord, checkCatchProgress, getWordDetail } from '../services/wordService';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';

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

router.get('/:wordId', authMiddleware, async (req: Request, res: Response) => {
  const word = await getWordDetail(Number(req.params.wordId));
  if (!word) return fail(res, 404, '单词不存在');
  ok(res, word);
});

export default router;
