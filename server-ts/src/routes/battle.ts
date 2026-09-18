import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';
import * as battleSvc from '../services/battleService';
import * as pvpSvc from '../services/battlePvpService';
import * as roomSvc from '../services/battleRoomService';

const router = Router();

// 创建一局 vs AI（用玩家当前 healthy 收服词组队）
router.post('/ai/start', authMiddleware, async (req: Request, res: Response) => {
  try {
    // spellMode: 'en-spell'（默认，拼英文）| 'zh-spell'（拼中文，填任一中文意思即可）
    const spellMode = req.body?.spellMode === 'zh-spell' ? 'zh-spell' : 'en-spell';
    const { battleId, snap } = await battleSvc.createBattle(req.userId!, spellMode);
    ok(res, { battleId, snap });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '创建对战失败');
  }
});

// ===== 金币场（真人 PvP）=====
// 可选押注档位
router.get('/gold/bets', authMiddleware, async (_req: Request, res: Response) => {
  ok(res, { options: pvpSvc.BET_OPTIONS });
});

// 加入匹配队列（body { bet }）
router.post('/gold/join', authMiddleware, async (req: Request, res: Response) => {
  const bet = Number(req.body?.bet);
  if (!Number.isFinite(bet)) return fail(res, 400, '缺少押注金额 bet');
  try {
    const r = await pvpSvc.joinQueue(req.userId!, bet);
    ok(res, r);
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '匹配失败');
  }
});

// 轮询匹配状态
router.get('/gold/queue', authMiddleware, async (req: Request, res: Response) => {
  try {
    ok(res, await pvpSvc.pollQueue(req.userId!));
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '查询失败');
  }
});

// 取消匹配
router.post('/gold/cancel', authMiddleware, async (req: Request, res: Response) => {
  try {
    await pvpSvc.cancelQueue(req.userId!);
    ok(res, { ok: true });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '取消失败');
  }
});

// ===== 金币场「房间」 =====
// 可选押注档位
router.get('/room/bets', authMiddleware, async (_req: Request, res: Response) => {
  ok(res, { options: roomSvc.BET_OPTIONS });
});

// 房间列表
router.get('/room/list', authMiddleware, async (req: Request, res: Response) => {
  try {
    ok(res, { rooms: await roomSvc.listRooms(req.userId!) });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '获取房间列表失败');
  }
});

// 创建房间 body { bet }
router.post('/room/create', authMiddleware, async (req: Request, res: Response) => {
  const bet = Number(req.body?.bet);
  if (!Number.isFinite(bet)) return fail(res, 400, '缺少押注金额 bet');
  try {
    ok(res, { room: await roomSvc.createRoom(req.userId!, bet) });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '创建房间失败');
  }
});

// 加入房间
router.post('/room/:roomId/join', authMiddleware, async (req: Request, res: Response) => {
  try {
    ok(res, { room: await roomSvc.joinRoom(Number(req.params.roomId), req.userId!) });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '加入房间失败');
  }
});

// 房间详情
router.get('/room/:roomId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const room = await roomSvc.roomViewById(Number(req.params.roomId), req.userId!);
    if (!room) return fail(res, 404, '房间不存在');
    ok(res, { room });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '查询失败');
  }
});

// 我的当前房间（断线重连恢复）
router.get('/room/mine/current', authMiddleware, async (req: Request, res: Response) => {
  try {
    ok(res, { room: await roomSvc.myRoom(req.userId!) });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '查询失败');
  }
});

// 准备
router.post('/room/:roomId/ready', authMiddleware, async (req: Request, res: Response) => {
  try {
    ok(res, { room: await roomSvc.setReady(Number(req.params.roomId), req.userId!) });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '准备失败');
  }
});

// 布阵/确认开战 body { order: [cardId,...] }
router.post('/room/:roomId/deploy', authMiddleware, async (req: Request, res: Response) => {
  const order = Array.isArray(req.body?.order) ? req.body.order.map(Number).filter((n: number) => Number.isFinite(n)) : [];
  try {
    const r = await roomSvc.deployRoom(Number(req.params.roomId), req.userId!, order);
    ok(res, r);
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '布阵失败');
  }
});

// 离开房间 body { reason?: 'leave'|'home' }
router.post('/room/:roomId/leave', authMiddleware, async (req: Request, res: Response) => {
  const reason = req.body?.reason === 'home' ? 'home' : 'leave';
  try {
    await roomSvc.leaveRoom(Number(req.params.roomId), req.userId!, reason);
    ok(res, { ok: true });
  } catch (err: unknown) {
    fail(res, 400, err instanceof Error ? err.message : '离开失败');
  }
});

// 拉取/心跳：超时会自动空过并让 AI 走一步；幂等
router.get('/:battleId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const snap = await battleSvc.pollBattle(Number(req.params.battleId), req.userId!);
    ok(res, { battleId: Number(req.params.battleId), snap });
  } catch (err: unknown) {
    fail(res, err instanceof Error && /不存在|无权/.test(err.message) ? 404 : 400, err instanceof Error ? err.message : '拉取失败');
  }
});

// 布阵：开战前自定义我方出场顺序。body { order: [cardId,...] }
router.post('/:battleId/deploy', authMiddleware, async (req: Request, res: Response) => {
  const battleId = Number(req.params.battleId);
  const order = Array.isArray(req.body?.order) ? req.body.order.map(Number).filter((n: number) => Number.isFinite(n)) : [];
  try {
    const snap = await battleSvc.deployBattle(battleId, req.userId!, order);
    ok(res, { battleId, snap });
  } catch (err: unknown) {
    fail(res, err instanceof Error && /不存在|无权/.test(err.message) ? 404 : 400, err instanceof Error ? err.message : '布阵失败');
  }
});

// 玩家行动：body { kind:'skill'|'revive', unit_card_id, target_card_id?, spell_correct }
router.post('/:battleId/act', authMiddleware, async (req: Request, res: Response) => {
  const battleId = Number(req.params.battleId);
  const { kind, unit_card_id, target_card_id, spell_correct } = req.body;
  if (!unit_card_id) return fail(res, 400, '缺少 unit_card_id');
  if (typeof spell_correct !== 'boolean') return fail(res, 400, '缺少 spell_correct');
  try {
    const snap = await battleSvc.playerAct(
      battleId,
      req.userId!,
      { kind: kind === 'revive' ? 'revive' : 'skill', unitCardId: unit_card_id, targetCardId: target_card_id ?? null },
      spell_correct
    );
    ok(res, { battleId, snap });
  } catch (err: unknown) {
    fail(res, err instanceof Error && /不存在|无权|还没轮到你|已结束/.test(err.message) ? 409 : 400, err instanceof Error ? err.message : '行动失败');
  }
});

export default router;
