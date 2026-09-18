import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool';
import { BattleQueueRow, BattleSnapshot, BattleUnit } from '../types';
import * as BL from '../utils/battleLogic';
import * as core from './battleService';

// ===== 金币场（真人 PvP）匹配 + 结算 =====
// 流程：joinQueue(bet) → 找同押注对手（乐观锁配对）→ 扣双方押注 → 建 battle(kind='gold')
//       两边各自布阵 → 开战 → 轮流出手 → 结束时赢家拿 2×bet

/** 可选押注档位 */
export const BET_OPTIONS = [10, 30, 50, 100, 200];

export interface JoinResult {
  status: 'waiting' | 'matched';
  battleId?: number;
  bet: number;
  queueId?: number;
  opponent?: { nickname: string };
}

async function getCoins(userId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT coins FROM users WHERE id = ?', [userId]);
  return Number((rows[0] as { coins?: number })?.coins) || 0;
}

async function getNickname(userId: number): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT nickname FROM users WHERE id = ?', [userId]);
  return ((rows[0] as { nickname?: string | null })?.nickname) || '训练师';
}

/**
 * 加入金币场队列（押注金额需为可选档位）。
 * 若已有同押注的等待者 → 立即配对建局；否则入队等待。
 */
export async function joinQueue(userId: number, bet: number): Promise<JoinResult> {
  if (!BET_OPTIONS.includes(bet)) throw new Error('押注金额不合法');
  const coins = await getCoins(userId);
  if (coins < bet) throw new Error(`金币不足（需 ${bet}，你有 ${coins}）`);
  // 💰 金币场：该档位需要的单词数（不足不让匹配）
  const needWords = BL.goldTroopSize(Number(bet));
  const myPool = await core.fetchBattlePool(userId);
  if (myPool.length < needWords) {
    throw new Error(`你的可出战单词只有 ${myPool.length} 个，不够本档位（${bet} 金币）需要的 ${needWords} 个`);
  }

  // 先清理自己之前的残留队列记录（重开匹配）
  await pool.execute('DELETE FROM battle_queue WHERE user_id = ? AND battle_id IS NULL', [userId]);

  // 找一个同押注、且不是自己的等待者
  const [cands] = await pool.execute<BattleQueueRow[]>(
    `SELECT * FROM battle_queue WHERE bet = ? AND user_id <> ? AND battle_id IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [bet, userId]
  );
  const opponent = cands[0];
  if (!opponent) {
    // 无人可配 → 入队等待
    const [ins] = await pool.execute<ResultSetHeader>(
      'INSERT INTO battle_queue (user_id, nickname, bet) VALUES (?, ?, ?)',
      [userId, await getNickname(userId), bet]
    );
    return { status: 'waiting', bet, queueId: ins.insertId };
  }

  // 乐观锁占住对手这条记录，防止并发重复配对
  const [lockRes] = await pool.execute<ResultSetHeader>(
    'UPDATE battle_queue SET battle_id = -1 WHERE id = ? AND battle_id IS NULL',
    [opponent.id]
  );
  if (lockRes.affectedRows === 0) {
    // 被别人抢先配走了 → 自己入队
    const [ins] = await pool.execute<ResultSetHeader>(
      'INSERT INTO battle_queue (user_id, nickname, bet) VALUES (?, ?, ?)',
      [userId, await getNickname(userId), bet]
    );
    return { status: 'waiting', bet, queueId: ins.insertId };
  }

  // 配对成功：扣双方押注（金币不足的对手视为取消，退回收其记录）
  const oppCoins = await getCoins(opponent.user_id);
  if (oppCoins < bet) {
    await pool.execute('DELETE FROM battle_queue WHERE id = ?', [opponent.id]);
    const [ins] = await pool.execute<ResultSetHeader>(
      'INSERT INTO battle_queue (user_id, nickname, bet) VALUES (?, ?, ?)',
      [userId, await getNickname(userId), bet]
    );
    return { status: 'waiting', bet, queueId: ins.insertId };
  }

  const battleId = await createGoldBattle(opponent.user_id, userId, bet);
  await pool.execute('UPDATE battle_queue SET battle_id = ? WHERE id = ?', [battleId, opponent.id]);
  // 自己也留一条已配对记录（用于「我的对战」查询）
  await pool.execute<ResultSetHeader>(
    'INSERT INTO battle_queue (user_id, nickname, bet, battle_id) VALUES (?, ?, ?, ?)',
    [userId, await getNickname(userId), bet, battleId]
  );
  return { status: 'matched', battleId, bet, opponent: { nickname: opponent.nickname || '训练师' } };
}

/** 查询自己当前匹配状态（前端轮询等待配对）。匹配到即消费该队列记录，避免重复命中旧局。 */
export async function pollQueue(userId: number): Promise<JoinResult> {
  const [rows] = await pool.execute<BattleQueueRow[]>(
    `SELECT * FROM battle_queue WHERE user_id = ? AND battle_id IS NOT NULL AND battle_id > 0
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (row && row.battle_id && row.battle_id > 0) {
    const [opp] = await pool.execute<BattleQueueRow[]>(
      'SELECT * FROM battle_queue WHERE battle_id = ? AND user_id <> ? LIMIT 1',
      [row.battle_id, userId]
    );
    // 消费（删除）自己的已配对记录，避免下次匹配命中旧局
    await pool.execute('DELETE FROM battle_queue WHERE id = ?', [row.id]);
    return {
      status: 'matched',
      battleId: row.battle_id,
      bet: row.bet,
      opponent: { nickname: opp[0]?.nickname || '训练师' },
    };
  }
  // 仍在等待
  const [waiting] = await pool.execute<BattleQueueRow[]>(
    'SELECT * FROM battle_queue WHERE user_id = ? AND battle_id IS NULL ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  if (!waiting[0]) return { status: 'waiting', bet: 0 };
  return { status: 'waiting', bet: waiting[0].bet, queueId: waiting[0].id };
}

/** 取消匹配 */
export async function cancelQueue(userId: number): Promise<void> {
  await pool.execute('DELETE FROM battle_queue WHERE user_id = ? AND battle_id IS NULL', [userId]);
}

/** 创建一局真人金币场对战：p0=side0, p1=side1；扣双方押注。 */
async function createGoldBattle(p0: number, p1: number, bet: number): Promise<number> {
  const [pool0, pool1] = await Promise.all([core.fetchBattlePool(p0), core.fetchBattlePool(p1)]);
  if (!pool0.length) throw new Error('对手没有可出战的健康单词');
  if (!pool1.length) throw new Error('你没有可出战的健康单词，先去收服并喂养');
  // 💰 金币场：按押注档位定阵容人数
  const troop = BL.goldTroopSize(Number(bet));
  if (pool0.length < troop) throw new Error(`对手的可出战单词只有 ${pool0.length} 个，不够本档位需要的 ${troop} 个`);
  if (pool1.length < troop) throw new Error(`你的可出战单词只有 ${pool1.length} 个，不够本档位需要的 ${troop} 个`);

  const player = core.buildSide(pool0, troop);
  const enemy = core.buildSide(pool1, troop);
  // 开局不给屏障：屏障靠拼对名词/形容词自己叠，不系统白送。
  // 先手优势由下面的投币决定（currentSide = Math.random() < 0.5 ? 0 : 1）。
  BL.ensureVerb(player);
  BL.ensureVerb(enemy);

  // 扣双方押注（原子：余额不足则回滚）
  const [r0] = await pool.execute<ResultSetHeader>(
    'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
    [bet, p0, bet]
  );
  if (r0.affectedRows === 0) throw new Error('对手金币不足，配对取消');
  const [r1] = await pool.execute<ResultSetHeader>(
    'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
    [bet, p1, bet]
  );
  if (r1.affectedRows === 0) {
    await pool.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [bet, p0]); // 退回 p0
    throw new Error('你的金币不足，配对取消');
  }

  const [n0, n1] = await Promise.all([getNickname(p0), getNickname(p1)]);
  const snap: BattleSnapshot = {
    turn: 1,
    currentSide: Math.random() < 0.5 ? 0 : 1, // 投币先手
    activeUntil: Date.now() + BL.TURN_SECONDS * 1000,
    turnStartedAt: Date.now(),
    turnSeconds: BL.TURN_SECONDS,
    over: false,
    winner: null,
    reason: '',
    deployed: false,
    mode: 'gold',
    bet,
    player: { userId: p0, nickname: n0, units: player.units, queue: [...player.queue], deployed: false },
    enemy: { userId: p1, nickname: n1, units: enemy.units, queue: [...enemy.queue], deployed: false },
    log: [`💰 金币场开战！双方各押 ${bet} 金币，赢家通吃。请各自布阵后开战。`],
  };
  const [ins] = await pool.execute<ResultSetHeader>(
    `INSERT INTO battles (player_user_id, enemy_user_id, mode, kind, bet, status, state, turn_now, turn_deadline, winner)
     VALUES (?, ?, 'pvp', 'gold', ?, 'active', ?, ?, ?, NULL)`,
    [p0, p1, bet, JSON.stringify(snap), snap.turn, snap.activeUntil]
  );
  return ins.insertId;
}
