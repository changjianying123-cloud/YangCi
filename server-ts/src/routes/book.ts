import { Router, Request, Response } from 'express';
import { listBooks, getBookByCode } from '../services/bookService';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';

const router = Router();

router.get('/list', authMiddleware, async (req: Request, res: Response) => {
  const data = await listBooks(req.userId!);
  ok(res, data);
});

router.get('/:bookCode', authMiddleware, async (req: Request, res: Response) => {
  const book = await getBookByCode(req.params.bookCode);
  if (!book) return fail(res, 404, '词书不存在');
  ok(res, book);
});

export default router;
