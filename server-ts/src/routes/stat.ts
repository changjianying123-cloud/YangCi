import { Router, Request, Response } from 'express';
import { getUserStats } from '../services/statService';
import { authMiddleware } from '../middleware/auth';
import { ok } from '../utils/response';

const router = Router();

router.get('/overview', authMiddleware, async (req: Request, res: Response) => {
  const data = await getUserStats(req.userId!);
  ok(res, data);
});

export default router;
