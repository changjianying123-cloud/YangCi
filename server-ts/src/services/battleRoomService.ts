import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool';
import { BattleRoomRow, RoomPlayerInfo, RoomView, RoomStatus, BattleUnit } from '../types';
import * as core from './battleService';
import * as BL from '../utils/battleLogic';
import { broadcastRoom, broadcastAll, pushToUser, isUserOnline } from '../ws/hub';

export const BET_OPTIONS = [10, 30, 50, 100, 200];

/** 布阵时长：2 分钟 */
export const DEPLOY_MS = 2 * 60 * 1000;
/** 断线判负：2 分钟（可用环境变量 DISCONNECT_LOSE_MS 覆盖，便于调试） */
export const DISCONNECT_LOSE_MS = Number(process.env.DISCONNECT_LOSE_MS) || 2 * 60 * 1000;
/** 未开赛房间双方离线后的宽限期：60s（用于刷新页面/重编译导致的瞬时断线） */
export const IDLE_GRACE_MS = Number(process.env.IDLE_GRACE_MS) || 60 * 1000;

// 断线计时：userId → 断线时间戳
const offlineAt = new Map<number, number>();
// 逃跑判负扫描定时器
let scanTimer: NodeJS.Timeout | null = null;

async function getWordCount(userId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM user_cards
     WHERE user_id = ? AND is_egg = 0 AND (abandoned IS NULL OR abandoned = 0)
       AND feed_deadline > ?`,
    [userId, Date.now()]
  );
  return Number((rows[0] as { c: number })?.c) || 0;
}

async function getUserInfo(userId: number): Promise<RoomPlayerInfo> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, nickname, avatar_url, coins FROM users WHERE id = ?',
    [userId]
  );
  const u = rows[0] as { id: number; nickname: string | null; avatar_url: string | null; coins: number } | undefined;
  return {
    userId,
    nickname: u?.nickname || `玩家${userId}`,
    avatarUrl: u?.avatar_url || null,
    coins: Number(u?.coins) || 0,
    wordCount: await getWordCount(userId),
    ready: false,
    deployed: false,
  };
}

async function loadRoom(roomId: number): Promise<BattleRoomRow | null> {
  const [rows] = await pool.execute<BattleRoomRow[]>('SELECT * FROM battle_rooms WHERE id = ?', [roomId]);
  return rows[0] || null;
}

function deployLeftOf(room: BattleRoomRow): number {
  if (!room.deploy_deadline) return 0;
  return Math.max(0, Math.ceil((Number(room.deploy_deadline) - Date.now()) / 1000));
}

/** 组装给前端看的房间视图 */
export async function roomView(room: BattleRoomRow, viewerId: number): Promise<RoomView> {
  const owner = await getUserInfo(room.owner_user_id);
  owner.ready = !!room.owner_ready;
  owner.deployed = !!room.owner_deployed;
  let guest: RoomPlayerInfo | null = null;
  if (room.guest_user_id) {
    guest = await getUserInfo(room.guest_user_id);
    guest.ready = !!room.guest_ready;
    guest.deployed = !!room.guest_deployed;
  }
  const myRole: RoomView['myRole'] =
    viewerId === room.owner_user_id ? 'owner' : viewerId === room.guest_user_id ? 'guest' : 'spectator';
  // 对手 id（从自己视角看）
  const opponentId =
    viewerId === room.owner_user_id ? room.guest_user_id : viewerId === room.guest_user_id ? room.owner_user_id : null;
  const view: RoomView = {
    id: room.id,
    bet: room.bet,
    status: room.status as RoomStatus,
    owner,
    guest,
    deployDeadline: Number(room.deploy_deadline) || 0,
    deployLeft: deployLeftOf(room),
    battleId: room.battle_id,
    winnerUserId: room.winner_user_id,
    myRole,
    createdAt: new Date(room.created_at).getTime(),
    opponentOnline: opponentId ? isUserOnline(opponentId) : false,
  };
  // 布阵阶段：给参战双方返回各自的出战阵容（用于渲染布阵列表）
  if (room.status === 'deploy' && myRole !== 'spectator') {
    try {
      const poolWords = await core.fetchBattlePool(viewerId);
      const side = core.buildSide(poolWords);
      const r = side as unknown as { units: BattleUnit[] };
      // ⭐ 方案 C：词性固定，不再推举兼职攻击手（此处也不同 ensureVerb）
      const saved = getDeployOrder(room.id, viewerId);
      const order = saved && saved.length ? saved : r.units.map((u) => u.cardId);
      view.myTroop = order
        .map((cid) => r.units.find((u) => u.cardId === cid))
        .filter((u): u is BattleUnit => !!u)
        .map((u) => ({ cardId: u.cardId, word: u.word, meaning: u.meaning, pos: String(u.role || ''), role: String(u.role || '') }));
    } catch (e) {
      // 获取失败不阻断房间视图
    }
  }
  return view;
}

/** 房间详情（指定视角） */
export async function roomViewById(roomId: number, viewerId: number): Promise<RoomView | null> {
  const room = await loadRoom(roomId);
  if (!room) return null;
  return await roomView(room, viewerId);
}

/** 房间列表（所有等待/准备/布阵/对战中的房间） */
export async function listRooms(viewerId = -1): Promise<RoomView[]> {
  const [rows] = await pool.execute<BattleRoomRow[]>(
    `SELECT * FROM battle_rooms WHERE status IN ('waiting','ready_check','deploy','playing')
     ORDER BY status = 'waiting' DESC, created_at DESC LIMIT 50`
  );
  const out: RoomView[] = [];
  for (const r of rows) out.push(await roomView(r, viewerId));
  return out;
}

/** 创建房间（房主自动入座） */
export async function createRoom(ownerId: number, bet: number): Promise<RoomView> {
  if (!BET_OPTIONS.includes(bet)) throw new Error('押注金额不合法');
  // 同一人只能有一个未结束的房间
  await pool.execute(
    `DELETE FROM battle_rooms WHERE owner_user_id = ? AND status IN ('waiting','ready_check')`,
    [ownerId]
  );
  const [ins] = await pool.execute<ResultSetHeader>(
    `INSERT INTO battle_rooms (owner_user_id, bet, status) VALUES (?, ?, 'waiting')`,
    [ownerId, bet]
  );
  const room = await loadRoom(ins.insertId);
  if (!room) throw new Error('创建房间失败');
  broadcastAll({ type: 'rooms_changed', data: {} });
  return await roomView(room, ownerId);
}

/** 加入房间（坐下） */
export async function joinRoom(roomId: number, userId: number): Promise<RoomView> {
  const room = await loadRoom(roomId);
  if (!room) throw new Error('房间不存在');
  if (room.status !== 'waiting') throw new Error('该房间已满或已开始');
  if (room.owner_user_id === userId) throw new Error('不能加入自己的房间');

  // 押注校验：金币需够（真正扣款在双方准备时）
  const [u] = await pool.execute<RowDataPacket[]>('SELECT coins FROM users WHERE id = ?', [userId]);
  const coins = Number((u[0] as { coins?: number })?.coins) || 0;
  if (coins < room.bet) throw new Error(`金币不足（需 ${room.bet}，你有 ${coins}）`);
  // 出战场地校验
  const words = await core.fetchBattlePool(userId);
  if (!words.length) throw new Error('你没有可出战的健康单词，先去收服并喂养');

  const [lock] = await pool.execute<ResultSetHeader>(
    `UPDATE battle_rooms SET guest_user_id = ?, status = 'ready_check'
     WHERE id = ? AND status = 'waiting' AND guest_user_id IS NULL`,
    [userId, roomId]
  );
  if (lock.affectedRows === 0) throw new Error('手慢了，房间已满');

  const updated = await loadRoom(roomId);
  if (!updated) throw new Error('房间不存在');
  await pushRoomToBoth(updated);
  broadcastAll({ type: 'rooms_changed', data: {} });
  return await roomView(updated, userId);
}

/** 点准备：双方都 ready → 扣押金币 → 进入布阵阶段（2 分钟倒计时） */
export async function setReady(roomId: number, userId: number): Promise<RoomView> {
  const room = await loadRoom(roomId);
  if (!room) throw new Error('房间不存在');
  const isOwner = room.owner_user_id === userId;
  const isGuest = room.guest_user_id === userId;
  if (!isOwner && !isGuest) throw new Error('你不在这个房间');

  // waiting（还没人入座）：房主可预先「准备」，对手一坐下就开（不报错，少一步操作）
  if (room.status === 'waiting') {
    if (!isOwner) throw new Error('等对手坐下后才能准备');
    await pool.execute('UPDATE battle_rooms SET owner_ready = 1 WHERE id = ?', [roomId]);
    const r0 = await loadRoom(roomId);
    if (r0) await pushRoomToBoth(r0);
    return await roomView(r0!, userId);
  }

  if (room.status !== 'ready_check') throw new Error('对局已开始或已结束，无需准备');

  const col = isOwner ? 'owner_ready' : 'guest_ready';
  await pool.execute(`UPDATE battle_rooms SET ${col} = 1 WHERE id = ?`, [roomId]);

  let updated = await loadRoom(roomId);
  if (!updated) throw new Error('房间不存在');

  // 双方都准备好 → 扣押押注 → 布阵阶段
  if (updated.owner_ready && updated.guest_ready && updated.status === 'ready_check') {
    await escrowBets(updated);
    updated = await loadRoom(roomId);
  }
  if (updated) await pushRoomToBoth(updated);
  return await roomView(updated!, userId);
}

/** 扣双方押注（原子，余额不足则抛错回滚到 ready_check→取消） */
async function escrowBets(room: BattleRoomRow) {
  const bet = Number(room.bet);
  const o = room.owner_user_id;
  const g = room.guest_user_id!;
  // 锁事务
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r1] = await conn.execute<ResultSetHeader>(
      'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
      [bet, o, bet]
    );
    if (r1.affectedRows === 0) throw new Error('房主金币不足');
    const [r2] = await conn.execute<ResultSetHeader>(
      'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
      [bet, g, bet]
    );
    if (r2.affectedRows === 0) throw new Error('你对局者金币不足');
    await conn.execute(
      `UPDATE battle_rooms SET status = 'deploy', escrowed = 1, deploy_deadline = ? WHERE id = ?`,
      [Date.now() + DEPLOY_MS, room.id]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    // 扣款失败 → 回到 ready_check，并重置 ready
    await pool.execute(
      `UPDATE battle_rooms SET status = 'ready_check', owner_ready = 0, guest_ready = 0 WHERE id = ?`,
      [room.id]
    );
    const msg = e instanceof Error ? e.message : '押注失败';
    pushToUser(room.owner_user_id, { type: 'room_error', data: { roomId: room.id, msg } });
    if (room.guest_user_id) pushToUser(room.guest_user_id, { type: 'room_error', data: { roomId: room.id, msg } });
    throw new Error(msg);
  } finally {
    conn.release();
  }
}

/** 布阵确认（点开战）。双方都确认 → 立刻开战；否则等对方/超时 */
export async function deployRoom(roomId: number, userId: number, order: number[]): Promise<{ room: RoomView; battleId: number | null; snap?: unknown }> {
  const room = await loadRoom(roomId);
  if (!room) throw new Error('房间不存在');
  if (room.status !== 'deploy') throw new Error('当前不在布阵阶段');
  const isOwner = room.owner_user_id === userId;
  const isGuest = room.guest_user_id === userId;
  if (!isOwner && !isGuest) throw new Error('你不在这个房间');

  // 保存该方出场顺序（存到独立字段：复用 battles 的 state 前先把顺序暂存）
  await saveDeployOrder(roomId, userId, order);

  const col = isOwner ? 'owner_deployed' : 'guest_deployed';
  await pool.execute(`UPDATE battle_rooms SET ${col} = 1 WHERE id = ?`, [roomId]);

  let updated = await loadRoom(roomId);
  if (!updated) throw new Error('房间不存在');

  // 双方都已确认 s 立即开战
  if (updated.owner_deployed && updated.guest_deployed) {
    let battleId: number;
    try {
      battleId = await startRoomBattle(updated);
    } catch (e) {
      // ⭐ C3：任一方无动词开不了战 → 退还押注、取消房间，不能让玩家押注卡住
      await cancelAndRefund(updated, e instanceof Error ? e.message : '开战失败');
      throw e;
    }
    updated = await loadRoom(roomId);
    await pushRoomToBoth(updated!);
    broadcastAll({ type: 'rooms_changed', data: {} });
    return { room: await roomView(updated!, userId), battleId, snap: null };
  }
  await pushRoomToBoth(updated);
  return { room: await roomView(updated, userId), battleId: null };
}

/** 暂存布阵顺序（用 map 存内存 + DB 兜底：这里直接存到 battle_rooms 的临时 JSON 列不可行，改用内存 map） */
const deployOrders = new Map<string, number[]>();
function orderKey(roomId: number, userId: number) { return `${roomId}:${userId}`; }
async function saveDeployOrder(roomId: number, userId: number, order: number[]) {
  deployOrders.set(orderKey(roomId, userId), order.filter((n) => Number.isFinite(n)));
}
function getDeployOrder(roomId: number, userId: number): number[] {
  return deployOrders.get(orderKey(roomId, userId)) || [];
}

/** 开战：用双方健康词建 battle，写入 battle_rooms.battle_id */
async function startRoomBattle(room: BattleRoomRow): Promise<number> {
  const o = room.owner_user_id;
  const g = room.guest_user_id!;
  const [pool0, pool1] = await Promise.all([core.fetchBattlePool(o), core.fetchBattlePool(g)]);
  if (!pool0.length) throw new Error('房主没有可出战的健康单词');
  if (!pool1.length) throw new Error('对手没有可出战的健康单词');

  const player = core.buildSide(pool0);
  const enemy = core.buildSide(pool1);
  // 应用各自布阵顺序
  const oOrder = getDeployOrder(room.id, o);
  const gOrder = getDeployOrder(room.id, g);
  applyOrder(player, oOrder);
  applyOrder(enemy, gOrder);
  // ⭐ 方案 C（C3）：词性固定不变，不自动推举兼职攻击手。
  //   若某一方队伍里一个动词都没有 → 不允许开战（退还押注+取消房间）。
  if (!player.units.some((u) => u.role === 'verb')) {
    throw new Error('房主的队伍里没有动词（攻击手），无法开战');
  }
  if (!enemy.units.some((u) => u.role === 'verb')) {
    throw new Error('对手的队伍里没有动词（攻击手），无法开战');
  }

  const [n0, n1] = await Promise.all([
    getNickname(o),
    getNickname(g),
  ]);
  const snap = {
    turn: 1,
    currentSide: Math.random() < 0.5 ? 0 : 1,
    activeUntil: Date.now() + BL.TURN_SECONDS * 1000,
    turnStartedAt: Date.now(),
    turnSeconds: BL.TURN_SECONDS,
    over: false,
    winner: null,
    reason: '',
    deployed: true,
    mode: 'gold' as const,
    // 金币场：显示英文、拼中文意思（同「拼中文」模式；与 AI 场拼中文一致）
    spellMode: 'zh-spell' as const,
    bet: room.bet,
    roomId: room.id,
    player: { userId: o, nickname: n0, units: player.units, queue: [...player.queue], deployed: true },
    enemy: { userId: g, nickname: n1, units: enemy.units, queue: [...enemy.queue], deployed: true },
    log: [`💰 双方已准备就绪，开战！赢家拿走 ${room.bet * 2} 金币。`],
  };
  const [ins] = await pool.execute<ResultSetHeader>(
    `INSERT INTO battles (player_user_id, enemy_user_id, mode, kind, bet, status, state, turn_now, turn_deadline, winner)
     VALUES (?, ?, 'pvp', 'gold', ?, 'active', ?, ?, ?, NULL)`,
    [o, g, room.bet, JSON.stringify(snap), snap.turn, snap.activeUntil]
  );
  await pool.execute(
    `UPDATE battle_rooms SET status = 'playing', battle_id = ? WHERE id = ?`,
    [ins.insertId, room.id]
  );
  await pushRoomToBoth({ ...room, status: 'playing', battle_id: ins.insertId } as BattleRoomRow);
  return ins.insertId;
}

function applyOrder(side: { units: { cardId: number }[]; queue: number[] }, order: number[]) {
  const ids = side.units.map((u) => u.cardId);
  const clean = order.filter((id) => ids.includes(id));
  for (const id of ids) if (!clean.includes(id)) clean.push(id);
  side.queue = clean;
}

async function getNickname(userId: number): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT nickname FROM users WHERE id = ?', [userId]);
  return ((rows[0] as { nickname?: string | null })?.nickname) || `玩家${userId}`;
}

/** 离开房间（房主在 waiting 时离开=解散；对局中离开=判负） */
export async function leaveRoom(roomId: number, userId: number, reason: 'leave' | 'home' = 'leave'): Promise<void> {
  const room = await loadRoom(roomId);
  if (!room) return;
  const isOwner = room.owner_user_id === userId;
  const isGuest = room.guest_user_id === userId;
  if (!isOwner && !isGuest) return;

  if (room.status === 'waiting' || room.status === 'ready_check') {
    // 未开局：解散
    await pool.execute(`UPDATE battle_rooms SET status = 'cancelled' WHERE id = ?`, [roomId]);
    const other = isOwner ? room.guest_user_id : room.owner_user_id;
    if (other) pushToUser(other, { type: 'room_closed', data: { roomId, reason: 'opponent_left' } });
    broadcastAll({ type: 'rooms_changed', data: {} });
    return;
  }
  if (room.status === 'deploy' || room.status === 'playing') {
    // 已开局：判负，对方赢底池
    await forfeitRoom(room, userId, reason === 'home' ? '回大厅' : '主动退出');
  }
}

/** 战斗自然结束 → 房间结算：winner 拿底池（平局退还） */
async function settleRoomBattle(room: BattleRoomRow, winnerId: number | null, reason: string): Promise<void> {
  const ref = await loadRoom(room.id);
  if (!ref || ref.status === 'finished' || ref.status === 'cancelled') return; // 幂等
  const pot = Number(room.bet) * 2;
  if (ref.escrowed) {
    if (winnerId) {
      await pool.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [pot, winnerId]);
    } else {
      // 平局：退还双方押注
      for (const uid of [ref.owner_user_id, ref.guest_user_id]) {
        if (uid) await pool.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [Number(ref.bet), uid]);
      }
    }
  }
  await pool.execute(
    `UPDATE battle_rooms SET status = 'finished', winner_user_id = ? WHERE id = ?`,
    [winnerId, ref.id]
  );
  const oWin = winnerId === ref.owner_user_id;
  pushToUser(ref.owner_user_id, {
    type: 'room_finished',
    data: { roomId: ref.id, win: oWin, pot: oWin ? pot : winnerId ? 0 : Number(ref.bet), reason, battleId: ref.battle_id },
  });
  if (ref.guest_user_id) {
    const gWin = winnerId === ref.guest_user_id;
    pushToUser(ref.guest_user_id, {
      type: 'room_finished',
      data: { roomId: ref.id, win: gWin, pot: gWin ? pot : winnerId ? 0 : Number(ref.bet), reason, battleId: ref.battle_id },
    });
  }
  broadcastAll({ type: 'rooms_changed', data: {} });
}

/** 判负：winner=对方，结算底池 */
export async function forfeitRoom(room: BattleRoomRow, loserId: number, why: string): Promise<void> {
  if (room.status === 'finished' || room.status === 'cancelled') return;
  const ref = await loadRoom(room.id);
  if (!ref || ref.status === 'finished') return; // 幂等

  // ⚠️ 若对局已经自然结束，必须按**真实胜负**结算，不能被“退出/断线”翻盘。
  // （否则赢家先赢下对局、随后退出/断线，就会被判负、底池发给输家）
  let winnerId = loserId === room.owner_user_id ? room.guest_user_id : room.owner_user_id;
  let reason = why;
  if (room.battle_id) {
    try {
      const snap0 = await core.loadBattle(room.battle_id);
      if (snap0 && snap0.over && (snap0.winner === 0 || snap0.winner === 1)) {
        const realWinner = snap0.winner === 0 ? room.owner_user_id : room.guest_user_id;
        if (realWinner) {
          winnerId = realWinner;
          reason = snap0.reason || '对局已结束';
        }
      }
    } catch { /* ignore，退回默认判负逻辑 */ }
  }
  if (!winnerId) return;

  const pot = Number(room.bet) * 2;
  // 只有已扣押才发奖
  if (room.escrowed) {
    await pool.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [pot, winnerId]);
  }
  await pool.execute(
    `UPDATE battle_rooms SET status = 'finished', winner_user_id = ? WHERE id = ?`,
    [winnerId, room.id]
  );
  // 同步落库到 battle 快照（若有）
  if (room.battle_id) {
    try {
      const snap = await core.loadBattle(room.battle_id);
      if (snap && !snap.over) {
        snap.over = true;
        snap.winner = winnerId === room.owner_user_id ? 0 : 1;
        snap.reason = `对手${why}，你获胜`;
        snap.log.push(`🏳️ ${await getNickname(loserId)} ${why}，判负。`);
        await core.saveBattle(room.battle_id, snap);
      }
    } catch (e) {
      console.error('[forfeitRoom] 同步 battle 快照失败:', e instanceof Error ? e.message : e);
    }
  }
  const winnerName = await getNickname(winnerId);
  pushToUser(winnerId, { type: 'room_finished', data: { roomId: room.id, win: true, pot, reason: `对手${why}`, battleId: room.battle_id } });
  pushToUser(loserId, { type: 'room_finished', data: { roomId: room.id, win: false, pot: 0, reason: winnerId === loserId ? reason : why, battleId: room.battle_id } });
  broadcastAll({ type: 'rooms_changed', data: {} });
  void winnerName;
}

/** 把房间最新态推给双方 */
async function pushRoomToBoth(room: BattleRoomRow) {
  const oView = await roomView(room, room.owner_user_id);
  pushToUser(room.owner_user_id, { type: 'room_update', data: oView });
  if (room.guest_user_id) {
    const gView = await roomView(room, room.guest_user_id);
    pushToUser(room.guest_user_id, { type: 'room_update', data: gView });
  }
}

// ===== 断线判负 & 布阵超时 =====

/** WS 断线回调 */
export function handleDisconnect(userId: number) {
  // 仍有其他活动连接（多标签页/重连中）→ 不算离线
  if (isUserOnline(userId)) return;
  offlineAt.set(userId, Date.now());
}

/** 上线回调 */
export function handleReconnect(userId: number) {
  offlineAt.delete(userId);
}

/** 启动定时扫描：断线超 2 分钟判负 + 布阵超时强制开战 */
export function startRoomScanner() {
  if (scanTimer) return;
  scanTimer = setInterval(async () => {
    try {
      const now = Date.now();
      const [rooms] = await pool.execute<BattleRoomRow[]>(
        `SELECT * FROM battle_rooms WHERE status IN ('waiting','ready_check','deploy','playing')`
      );
      for (const room of rooms) {
        // 0) 空闲房间清理：waiting 超过 10 分钟无人加入 / ready_check 超过 10 分钟没人准备
        if (room.status === 'waiting' || room.status === 'ready_check') {
          const age = now - new Date(room.created_at).getTime();
          // 双方都离线：不能一断线就取消（刷新页面/重新编译会瞬时断线），给 60s 宽限
          const offOwner = room.owner_user_id ? offlineAt.get(room.owner_user_id) : 0;
          const offGuest = room.guest_user_id ? offlineAt.get(room.guest_user_id) : 1;
          const ownerOffLong = !!room.owner_user_id && !!offOwner && now - offOwner > IDLE_GRACE_MS;
          const guestOffLong = !!room.guest_user_id && !!offGuest && now - offGuest > IDLE_GRACE_MS;
          const bothOffline = ownerOffLong && guestOffLong;
          if (age > 10 * 60 * 1000 || bothOffline) {
            await pool.execute(
              `UPDATE battle_rooms SET status='cancelled', updated_at=NOW() WHERE id=? AND status IN ('waiting','ready_check')`,
              [room.id]
            );
            if (room.owner_user_id) offlineAt.delete(room.owner_user_id);
            if (room.guest_user_id) offlineAt.delete(room.guest_user_id);
            broadcastAll({ type: 'rooms_changed', data: {} });
            continue;
          }
        }
        // 1) 布阵超时 → 强制开战
        if (room.status === 'deploy' && room.deploy_deadline && now > Number(room.deploy_deadline)) {
          try {
            const battleId = await startRoomBattle(room);
            const fresh = await loadRoom(room.id);
            if (fresh) await pushRoomToBoth(fresh);
            broadcastAll({ type: 'rooms_changed', data: {} });
            void battleId;
          } catch (e) {
            // 建局失败（如某方无词）→ 取消并退款
            await cancelAndRefund(room, e instanceof Error ? e.message : '布阵超时建局失败');
          }
          continue;
        }
        // 2) 对战中：①若 battle 已自然结束 → 房间结算；②断线超 2 分钟 → 判负
        if (room.status === 'playing') {
          // 2.0 对局超时（10 分钟无更新且 battle 已丢）→ 按平局退还押注
          const stale = now - new Date(room.updated_at).getTime();
          if (stale > 10 * 60 * 1000) {
            let battleGone = !room.battle_id;
            if (room.battle_id) {
              try { const s = await core.loadBattle(room.battle_id); if (!s) battleGone = true; } catch { battleGone = true; }
            }
            if (battleGone) { await settleRoomBattle(room, null, '对局超时结束'); continue; }
          }
          // 2.1 战斗自然结束（一方全灭）→ 房间结算发奖
          if (room.battle_id) {
            try {
              const snap = await core.loadBattle(room.battle_id);
              if (snap && snap.over && !room.winner_user_id) {
                const winSide = snap.winner; // 0=房主, 1=客人
                const winnerId = winSide === 0 ? room.owner_user_id : winSide === 1 ? room.guest_user_id : null;
                await settleRoomBattle(room, winnerId, snap.reason || '');
                continue;
              }
              // 2.1b 死局兜底：对局还 active，但已远超回合时限仍无人行动（双方都走了）→ 按平局退押
              if (snap && !snap.over && snap.activeUntil && now - Number(snap.activeUntil) > 3 * 60 * 1000) {
                await settleRoomBattle(room, null, '双方长时间未行动，对局中止');
                continue;
              }
            } catch { /* ignore */ }
          }
          // 2.2 断线超时 → 判负（仅当该玩家确实不在线时才判，防误杀）
          for (const uid of [room.owner_user_id, room.guest_user_id]) {
            if (!uid) continue;
            if (isUserOnline(uid)) { offlineAt.delete(uid); continue; }
            const off = offlineAt.get(uid);
            if (off && now - off > DISCONNECT_LOSE_MS) {
              await forfeitRoom(room, uid, '断线超过2分钟');
              offlineAt.delete(uid);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.error('[roomScanner]', e);
    }
  }, 5000);
}

/** 取消房间并退还押注 */
export async function cancelAndRefund(room: BattleRoomRow, why: string) {
  if (room.escrowed) {
    const bet = Number(room.bet);
    const users: number[] = [];
    if (room.owner_user_id) users.push(room.owner_user_id);
    if (room.guest_user_id) users.push(room.guest_user_id);
    for (const uid of users) {
      await pool.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [bet, uid]);
      pushToUser(uid, { type: 'room_closed', data: { roomId: room.id, reason: why, refunded: bet } });
    }
  }
  await pool.execute(`UPDATE battle_rooms SET status = 'cancelled' WHERE id = ?`, [room.id]);
  broadcastAll({ type: 'rooms_changed', data: {} });
}

/** 查询我的当前房间（用于断线重连恢复） */
export async function myRoom(userId: number): Promise<RoomView | null> {
  const [rows] = await pool.execute<BattleRoomRow[]>(
    `SELECT * FROM battle_rooms
     WHERE (owner_user_id = ? OR guest_user_id = ?) AND status IN ('waiting','ready_check','deploy','playing')
     ORDER BY created_at DESC LIMIT 1`,
    [userId, userId]
  );
  if (!rows[0]) return null;
  return await roomView(rows[0], userId);
}

export { isUserOnline };
