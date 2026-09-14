import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool';
import { BattleRow, BattleRole, BattleSide, BattleSnapshot, BattleUnit } from '../types';
import * as BL from '../utils/battleLogic';

// ===== 单词对战：编排 + 持久化（服务端唯一裁决，杜绝作弊）=====

export interface PickedWord extends RowDataPacket {
  cardId: number;
  wordId: number;
  level: number;
  word: string;
  meaning: string;
  phonetic: string | null;
  audio_url: string | null;
  pos: string | null;
}

export function pickCardId(u: BattleUnit): number {
  return u.cardId;
}

/** 取某玩家可出战的词：已收服 + healthy(normal)=非蛋未弃 & feed_deadline>now。不再强制要求词性标注（无 pos 的词默认当名词/护盾用） */
async function fetchBattlePool(userId: number): Promise<PickedWord[]> {
  const now = Date.now();
  const [rows] = await pool.execute<PickedWord[]>(
    `SELECT uc.id AS cardId, w.id AS wordId, uc.level, w.word, w.meaning, w.phonetic, w.audio_url, w.pos
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     WHERE uc.user_id = ?
       AND (uc.abandoned IS NULL OR uc.abandoned = 0)
       AND uc.is_egg = 0
       AND uc.feed_deadline > ?      -- 仍在饱腹期 = healthy
     ORDER BY RAND()`,
    [userId, now]
  );
  return rows;
}

/** AI 词池：其它玩家身上 healthy 的词凑（演示用） */
async function fetchAiPool(limit = 80): Promise<PickedWord[]> {
  const now = Date.now();
  const [rows] = await pool.execute<PickedWord[]>(
    `SELECT uc.id AS cardId, w.id AS wordId, uc.level, w.word, w.meaning, w.phonetic, w.audio_url, w.pos
     FROM user_cards uc
     JOIN words w ON w.id = uc.word_id
     WHERE (uc.abandoned IS NULL OR uc.abandoned = 0)
       AND uc.is_egg = 0
       AND uc.feed_deadline > ?
     ORDER BY RAND()
     LIMIT ${limit}`,
    [now]
  );
  return rows;
}

function rolesOf(c: PickedWord): BattleRole[] {
  const roles = (c.pos || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((r): r is BattleRole => r === 'noun' || r === 'adjective' || r === 'verb' || r === 'adverb');
  // 无词性标注(例如 'other')的词默认当名词（护盾手），保证能进战斗
  return roles.length ? roles : ['noun'];
}

// 导出给 PvP 服务复用
export { rolesOf, fetchBattlePool };
export type { PickedWord as PickedWordType };

/** 把词池组一支部队（PvP 复用），返回 units+queue；不设壁垒，由调用方处理 */
export function buildSide(poolWords: PickedWord[], sizeOverride?: number): { units: BattleUnit[]; queue: number[] } {
  return formSide(poolWords, sizeOverride);
}

/**
 * 从池子里组一支部队（BL.TROOP_SIZE 个）：
 *   - 至少 1 个作战动词
 *   - 词性尽量均衡（verb/noun/adjective/adverb 都尽量来一个，剩余补）
 *   - 多词性词可被“改编”成缺失角色
 * 若词不足 BL.TROOP_SIZE 则有多少用多少（仍需至少 1 verb 才能开打，否则由 checkEnd 判负）。
 */
function formSide(poolWords: PickedWord[], sizeOverride?: number): { units: BattleUnit[]; queue: number[] } {
  const byRole: Record<BattleRole, PickedWord[]> = { noun: [], adjective: [], verb: [], adverb: [] };
  for (const c of poolWords) for (const r of rolesOf(c)) byRole[r].push(c);

  const want = Math.min(sizeOverride || BL.TROOP_SIZE, poolWords.length);
  const used = new Set<number>();
  const chosen: { c: PickedWord; role: BattleRole }[] = [];

  const take = (role: BattleRole): boolean => {
    for (const cand of byRole[role]) {
      if (!used.has(cand.cardId)) {
        used.add(cand.cardId);
        chosen.push({ c: cand, role });
        return true;
      }
    }
    return false;
  };

  // 分发目标数：先保证动词，尽量各 1，剩余随意
  const targetCounts: Record<BattleRole, number> = {
    verb: Math.max(1, want < 4 ? want : Math.min(2, want - 3)), // 至少1，宽裕时2
    noun: 1, adjective: 1, adverb: 1,
  };

  // 第一遍：按序尽量满足各 target（动词先）
  for (const role of (['verb', 'noun', 'adjective', 'adverb'] as BattleRole[])) {
    for (let n = 0; n < targetCounts[role] && chosen.length < want; n++) take(role);
  }
  // 第二遍：还有空位 → 随意补未用词(优先动词增攻/名词)
  if (chosen.length < want) {
    for (const c of poolWords) {
      if (used.has(c.cardId)) continue;
      used.add(c.cardId);
      const r = rolesOf(c);
      chosen.push({ c, role: r[0] || 'noun' });
      if (chosen.length >= want) break;
    }
  }

  const units: BattleUnit[] = chosen.map(({ c, role }) => ({
    cardId: c.cardId,
    wordId: c.wordId,
    word: c.word,
    meaning: c.meaning,
    role,
    level: c.level,
    maxHp: BL.maxHpFor(c.level, role),
    hp: BL.maxHpFor(c.level, role),
    atkBuff: 0,
    shield: 0,
    dead: false,
    usedSkill: false,
    revived: false,
  }));
  return { units, queue: units.map((u) => u.cardId) };
}

// ---------- 建局 ----------
export async function createBattle(playerUserId: number): Promise<{ battleId: number; snap: BattleSnapshot }> {
  const playerPool = await fetchBattlePool(playerUserId);
  const aiPool = await fetchAiPool();
  const player = formSide(playerPool);
  // 一击必杀制：双方全部单位开局各 1 层屏障，把“先手一击”降级为“先手破盾”，削弱先手碾压
  for (const u of player.units) if (!u.dead) u.shield = Math.max(u.shield || 0, 1);
  // 一击必杀制下后手的 AI 吃亏：给 AI 每个单位 1 层开局屏障作为先手补偿
  const enemy = formSide(aiPool);
  for (const u of enemy.units) {
    if (!u.dead) u.shield = Math.max(u.shield || 0, 1);
    const lv = Math.max(1, (u.level || 1) - 1);
    u.level = lv;
    u.maxHp = BL.maxHpFor(lv, u.role);
    u.hp = u.maxHp;
  }


  if (player.units.length === 0) throw new Error('你还没有健康的可出战单词，先去收服并喂养一些吧');
  // 只要有健康单词就能开打：全队没动词时，挑一个词兼职攻击手（不再直接报错）
  BL.ensureVerb(player);

  const [nickR] = await pool.execute<RowDataPacket[]>('SELECT nickname, openid FROM users WHERE id = ?', [playerUserId]);
  const r0 = nickR[0] as { nickname?: string | null };
  const nickname = r0?.nickname || '我';

  const snap: BattleSnapshot = {
    turn: 1,
    currentSide: 0,
    activeUntil: Date.now() + BL.TURN_SECONDS * 1000,
    turnStartedAt: Date.now(),
    turnSeconds: BL.TURN_SECONDS,
    over: false,
    winner: null,
    reason: '',
    mode: 'rookie',
    player: { userId: playerUserId, nickname, units: player.units, queue: [...player.queue] },
    enemy: { userId: -1, nickname: '🤖 AI', units: enemy.units, queue: [...enemy.queue] },
    log: ['⚔️ 对战开始！你是先手。拼写正确即可触发词性技能。'],
  };
  BL.scanAutoEnd(snap);
  const [ins] = await pool.execute<ResultSetHeader>(
    `INSERT INTO battles (player_user_id, enemy_user_id, mode, kind, bet, status, state, turn_now, turn_deadline, winner)
     VALUES (?, NULL, 'ai', 'rookie', 0, ?, ?, ?, ?, ?)`,
    [playerUserId, snap.over ? 'finished' : 'active', JSON.stringify(snap), snap.turn, snap.activeUntil, snap.winner]
  );
  const battleId = ins.insertId;
  return { battleId, snap };
}

/** 布阵：玩家在开战前自定义自己 5 个参战单词的出场顺序（队列顺序=站位：前 FRONT_SIZE 个为一线） */
export async function deployBattle(
  battleId: number,
  playerUserId: number,
  order: number[]
): Promise<BattleSnapshot> {
  const snap = await loadBattle(battleId);
  if (!snap) throw new Error('对战不存在');
  const side = sideIdx(snap, playerUserId);
  if (side == null) throw new Error('无权操作该对战');
  if ((snap as any).deployed) throw new Error('战斗已开始，无法再调整站位');
  if (snap.turn > 1 || snap.over) throw new Error('战斗已开始，无法再调整站位');

  const me = side === 0 ? snap.player : snap.enemy;
  const ids = me.units.map((u) => u.cardId);
  const clean = (order || []).filter((id) => ids.includes(id));
  for (const id of ids) if (!clean.includes(id)) clean.push(id);
  me.queue = clean;
  me.deployed = true;

  if (isPvp(snap)) {
    // 真人 PvP：双方都布阵后才真正开战（投币先手已在建局时定）
    if (!snap.player.deployed || !snap.enemy.deployed) {
      snap.log.push(`⏳ ${me.nickname} 已布阵，等待对手…`);
      await saveBattle(battleId, snap);
      return snap;
    }
    (snap as any).deployed = true;
    snap.activeUntil = Date.now() + BL.TURN_SECONDS * 1000;
    snap.turnStartedAt = Date.now();
    snap.turnSeconds = BL.TURN_SECONDS;
    snap.log.push('🚩 双方均已布阵，开战！');
    snap.log.push(snap.currentSide === 0 ? `🎲 ${snap.player.nickname} 先手` : `🎲 ${snap.enemy.nickname} 先手`);
    BL.scanAutoEnd(snap);
    if (snap.over) await settlePvpReward(snap);
    await saveBattle(battleId, snap);
    return snap;
  }

  (snap as any).deployed = true;
  // 一击必杀制下先手有优势：开战投币决定先手（50/50），双方开局各 1 层屏障削弱先手碾压。
  const first = Math.random() < 0.5 ? 0 : 1;
  snap.currentSide = first;
  (snap as any).playerFirst = first === 0;
  snap.activeUntil = Date.now() + BL.TURN_SECONDS * 1000;
  snap.turnStartedAt = Date.now();
  snap.turnSeconds = BL.TURN_SECONDS;
  snap.log.push('🚩 已按你的站位布置阵型，开战！');
  snap.log.push(first === 0 ? '🎲 你先手，请出招。' : '🎲 对手先手，请稍候…');
  BL.scanAutoEnd(snap);
  await saveBattle(battleId, snap);
  return snap;
}

export async function loadBattle(battleId: number): Promise<BattleSnapshot | null> {
  const [rows] = await pool.execute<BattleRow[]>('SELECT state FROM battles WHERE id = ?', [battleId]);
  if (!rows[0]) return null;
  const snap = JSON.parse(rows[0].state) as BattleSnapshot;
  (snap as any).battleId = battleId; // 供结算原子防重使用
  return snap;
}

export async function saveBattle(battleId: number, snap: BattleSnapshot) {
  const over = snap.over;
  await pool.execute(
    `UPDATE battles
     SET state = ?, status = ?, turn_now = ?, turn_deadline = ?, winner = ?,
         finished_at = IF(? , NOW(), finished_at)
     WHERE id = ?`,
    [JSON.stringify(snap), over ? 'finished' : 'active', snap.turn, snap.activeUntil, snap.winner, over, battleId]
  );
}

function sideIdx(snap: BattleSnapshot, userId: number): 0 | 1 | null {
  if (snap.player && snap.player.userId === userId) return 0;
  // 真人 PvP：敌方也是真实 userId
  if (snap.enemy && snap.enemy.userId > 0 && snap.enemy.userId === userId) return 1;
  return null; // AI 的 enemy-userId=-1 不对外
}

/** 是否真人 PvP（两边都是真实用户） */
function isPvp(snap: BattleSnapshot): boolean {
  return !!(snap.enemy && snap.enemy.userId > 0);
}

function guardTurn(snap: BattleSnapshot, side: number) {
  if (snap.over) throw new Error('对战已结束');
  if (!(snap as any).deployed) throw new Error('请先「开战」完成布阵');
  if (snap.currentSide !== side) throw new Error('还没轮到你行动');
}

/** 客户端“拉取/心跳”：若已超时且该轮到玩家，则判空过并交给 AI，返回最新快照。幂等可重复调用。 */
export async function pollBattle(battleId: number, playerUserId: number): Promise<BattleSnapshot> {
  const snap = await loadBattle(battleId);
  if (!snap) throw new Error('对战不存在');
  if (snap.over) return snap;
  const side = sideIdx(snap, playerUserId);
  if (side == null) throw new Error('无权操作该对战');
  // 布阵阶段：不计时、不推进回合，等玩家点「开战」
  if (!(snap as any).deployed) return snap;
  const pvp = isPvp(snap);
  // 开战投币判定为 AI 先手：先进入敌方回合（倒计时），等倒计时到再出手
  if (!pvp && snap.currentSide === 1 && !(snap as any).aiOpened) {
    (snap as any).aiOpened = true;
    beginEnemyTurn(snap);
    await saveBattle(battleId, snap);
    return snap;
  }
  // AI 模式：敌方回合且倒计时已到 → 执行一次 AI 行动，然后回到玩家回合
  if (!pvp && snap.currentSide === 1 && Date.now() > snap.activeUntil) {
    await resolveToPlayerTurn(battleId, snap);
    return snap;
  }
  // 真人 PvP：双方轮流；若轮到你但已超时 → 判空过，切给对方
  if (pvp && snap.currentSide === side && Date.now() > snap.activeUntil) {
    snap.log.push(`⏰ ${snap.currentSide === 0 ? snap.player.nickname : snap.enemy.nickname} 回合超时，空过`);
    await advancePvpTurn(battleId, snap);
    return snap;
  }
  await saveBattle(battleId, snap);
  return snap;
}

/**
 * 玩家进行一个完整动作（30s 内）：
 *  action.kind='skill' → 选一个前排词，按它词性发动技能；spellCorrect 为拼写判定。
 *  action.kind='revive' → 在阵亡列救一个可复活词；spellCorrect 判定成败。
 *  动作后若未结束 → 交给 AI，回来时回到玩家回合。
 */
export async function playerAct(
  battleId: number,
  playerUserId: number,
  action: { kind: 'skill' | 'revive'; unitCardId: number; targetCardId?: number | null },
  spellCorrect: boolean
): Promise<BattleSnapshot> {
  const snap = await loadBattle(battleId);
  if (!snap) throw new Error('对战不存在');
  const side = sideIdx(snap, playerUserId);
  if (side == null) throw new Error('无权操作该对战');
  guardTurn(snap, side);
  const me = side === 0 ? snap.player : snap.enemy;

  const timedOut = Date.now() > snap.activeUntil;
  if (timedOut) {
    snap.log.push('⏰ 你的回合已超时，本次操作无效，判为空过');
  } else if (action.kind === 'skill') {
    const u = me.units.find((x) => x.cardId === action.unitCardId);
    const wname = u ? u.word : `#${action.unitCardId}`;
    if (!spellCorrect) {
      snap.log.push(`❌ 拼写错误，「${wname}」技能未能发动（本次行动作废）`);
    } else {
      try {
        const out = BL.useFrontSkill(snap, side, action.unitCardId, action.targetCardId ?? null);
        snap.log.push(out.log);
      } catch (e: any) {
        // 非法动作(不在前排/目标非法)：useFrontSkill 在 throw 前不改动状态，可安全重试，抛给前端
        throw new Error(e instanceof Error ? e.message : '行动失败');
      }
    }
  } else {
    // revive
    const out = BL.tryRevive(snap, side, action.unitCardId, spellCorrect);
    snap.log.push(out.log);
  }

  BL.scanAutoEnd(snap);
  if (!snap.over) {
    if (isPvp(snap)) {
      // 真人 PvP：出手一次即切给对方（带倒计时）
      await advancePvpTurn(battleId, snap);
      return snap;
    }
    // 回合制：玩家出手一次即结束我方回合 → 进入敌方回合（开始倒计时，模拟真人思考）
    beginEnemyTurn(snap);
  } else if (isPvp(snap)) {
    // 本次行动直接结束了对局 → 结算金币
    await settlePvpReward(snap);
  }
  await saveBattle(battleId, snap);
  return snap;
}

/** 真人 PvP：结束当前回合并切换行动方（轮到的玩家带倒计时）。 */
async function advancePvpTurn(battleId: number, snap: BattleSnapshot) {
  snap.turn += 1;
  if (snap.turn > BL.MAX_TURNS) {
    BL.suddenDeath(snap);
  } else {
    for (const s of [snap.player, snap.enemy]) {
      BL.cleanupQueue(s);
      BL.promoteBackline(s);
      BL.resetTurnFlags(s);
    }
    BL.ensureVerbs(snap);
    // 切换行动方
    snap.currentSide = snap.currentSide === 0 ? 1 : 0;
    const nextName = snap.currentSide === 0 ? snap.player.nickname : snap.enemy.nickname;
    snap.log.push(`🎯 轮到 ${nextName} 行动`);
  }
  snap.activeUntil = Date.now() + BL.TURN_SECONDS * 1000;
  snap.turnStartedAt = Date.now();
  snap.turnSeconds = BL.TURN_SECONDS;
  // PvP 结束 → 结算金币
  if (snap.over) await settlePvpReward(snap);
  await saveBattle(battleId, snap);
}

/** PvP 结束结算：赢家拿走底池（2×bet），输家不返还（入场已扣）。幂等：靠 battle.rewards 非空判定。 */
async function settlePvpReward(snap: BattleSnapshot) {
  if (snap.mode !== 'gold' || !snap.bet) return;
  if ((snap as any).settled) return;
  (snap as any).settled = true;
  // 房间制金币场：结算由 battleRoom 服务负责（避免重复发奖）
  if ((snap as any).roomId) return;
  const pot = snap.bet * 2;
  const detail =
    snap.winner === 0 || snap.winner === 1
      ? { winner: snap.winner, pot, bet: snap.bet }
      : { winner: null, pot: 0, bet: snap.bet };
  // 原子防重：仅当该局 rewards 为空时才能写入（并发下只有一个成功）
  const [lock] = await pool.execute<ResultSetHeader>(
    'UPDATE battles SET rewards = ? WHERE id = ? AND (rewards IS NULL OR rewards = \'\')',
    [JSON.stringify(detail), (snap as any).battleId ?? 0]
  );
  if (lock.affectedRows === 0) return; // 已被别处结算，跳过
  if (snap.winner === 0 || snap.winner === 1) {
    const winUser = snap.winner === 0 ? snap.player.userId : snap.enemy.userId;
    await pool.execute('UPDATE users SET coins = coins + ? WHERE id = ?', [pot, winUser]);
    snap.log.push(`💰 ${snap.winner === 0 ? snap.player.nickname : snap.enemy.nickname} 获胜，赢得 ${pot} 金币`);
  } else {
    // 平局/无胜者：双方退还押注
    await pool.execute('UPDATE users SET coins = coins + ? WHERE id IN (?, ?)', [snap.bet, snap.player.userId, snap.enemy.userId]);
    snap.log.push(`💰 平局，双方退还押注 ${snap.bet} 金币`);
  }
}

/** 进入敌方回合：设倒计时（AI 思考时间，模拟真人犹豫），期间客户端显示敌方倒计时。 */
function beginEnemyTurn(snap: BattleSnapshot) {
  snap.currentSide = 1;
  // 模拟真人思考：5~14 秒随机延迟
  const think = 5 + Math.floor(Math.random() * 10);
  snap.activeUntil = Date.now() + think * 1000;
  snap.turnStartedAt = Date.now();
  snap.turnSeconds = think;
  snap.log.push('🤖 敌方回合，思考中…');
  BL.scanAutoEnd(snap);
}

/** 让 AI 走完它整个前排（每个词一次），然后回到玩家回合。 */
async function resolveToPlayerTurn(battleId: number, snap: BattleSnapshot) {
  // —— 敌方回合：执行一次 AI 行动，然后交回玩家 ——
  snap.currentSide = 1;
  BL.scanAutoEnd(snap);
  if (!snap.over) {
    // 一次只让一个「本回合未出手」的前排词行动
    aiAct(snap);
    BL.scanAutoEnd(snap);
  }
  if (!snap.over) {
    snap.turn += 1;
    if (snap.turn > BL.MAX_TURNS) {
      BL.suddenDeath(snap); // 打满兜底决胜
    } else {
      // 回合末：前后排补位 + 重置出手标记 + 保底攻击手，让每个存活单位下回合都能再行动
      for (const side of [snap.player, snap.enemy]) {
        BL.cleanupQueue(side);
        BL.promoteBackline(side);
        BL.resetTurnFlags(side);
      }
      BL.ensureVerbs(snap);
      snap.currentSide = 0;
      snap.log.push('🎯 轮到你行动');
    }
    snap.activeUntil = Date.now() + BL.TURN_SECONDS * 1000;
    snap.turnStartedAt = Date.now();
    snap.turnSeconds = BL.TURN_SECONDS;
  }
  await saveBattle(battleId, snap);
}

/** AI 行动（就地改 snap，一次只让一个「本回合未出手」的前排词行动）：AI 拼写恒对。 */
function aiAct(snap: BattleSnapshot) {
  const me = snap.enemy;
  BL.cleanupQueue(me);
  BL.cleanupQueue(snap.player);
  // 只取本回合还没出过手的前排词
  const myFront = BL.standingQueue(me).slice(0, BL.FRONT_SIZE)
    .map((id) => me.units.find((x) => x.cardId === id))
    .filter((u): u is any => !!u && !u.dead && !u.usedSkill);
  if (myFront.length === 0) return; // 前排都行动过了

  const foeTargets = BL.attackableTargets(snap.player);
  const revivable = me.units.find((x) => BL.canRevive(x));

  const plan: { unitId: number; kind: 'skill' | 'revive'; target?: number | null; ok?: boolean }[] = [];

  const pick = (role: string) => myFront.find((u) => u.role === role) || null;
  // 用于“被强化/被护盾”的目标：优先未出手的同侧单位(不会浪费)，否则任意存活同侧
  const pickTarget = (role: string) => {
    const all = BL.standingQueue(me)
      .map((id) => me.units.find((x) => x.cardId === id))
      .filter((u): u is any => !!u && !u.dead);
    return all.find((u) => u.role === role && !u.usedSkill) || all.find((u) => u.role === role) || null;
  };

  const verbFront = pick('verb');
  const nounFront = pick('noun');
  const adjFront = pick('adjective');
  const advFront = pick('adverb');
  // 强化目标：优先还设出手的动词(副词)/名词(形容词)
  const verbTarget = pickTarget('verb');
  const nounTarget = pickTarget('noun');

  // 攻击优先；一击必杀制下优先攻击「无屏障」目标（可直接击杀）；有副词先强化未出手动词，有形容词先叠盾，剩的拿名词自保
  if (verbFront && foeTargets.length) {
    // 先找无屏障目标（可直接击杀），否则挑屏障最少的
    const noShield = foeTargets.find((t) => (t.shield || 0) === 0 && !t.shieldBroken) || foeTargets.find((t) => (t.shield || 0) === 0);
    const weakest = foeTargets.slice().sort((a, b) => (a.shield || 0) - (b.shield || 0))[0];
    const pickT = noShield || weakest;
    plan.push({ unitId: verbFront.cardId, kind: 'skill', target: pickT.cardId });
  }
  // 副词：优先强化「未出手且未满级」的动词（加成可破盾击杀）
  if (advFront && verbTarget && verbTarget.atkBuff < BL.ATK_BUFF_CAP) {
    plan.push({ unitId: advFront.cardId, kind: 'skill', target: verbTarget.cardId });
  }
  // 形容词：给没有屏障的名词补盾（防被一击必杀）
  if (adjFront && nounTarget && nounTarget.shield < BL.SHIELD_CAP && !nounTarget.shieldBroken) {
    plan.push({ unitId: adjFront.cardId, kind: 'skill', target: nounTarget.cardId });
  }
  // 名词自保：优先给「无屏障」的友军(包括自己)叠盾
  if (nounFront) {
    const needShield = BL.standingQueue(me)
      .map((id) => me.units.find((x) => x.cardId === id))
      .find((x): x is any => !!x && !x.dead && !x.shieldBroken && (x.shield || 0) === 0);
    plan.push({ unitId: nounFront.cardId, kind: 'skill', target: (needShield || nounFront).cardId });
  }
  if (!plan.length && revivable) {
    plan.push({ unitId: revivable.cardId, kind: 'revive', ok: Math.random() < 0.85 });
  }
  // 兜底：用第一个未出手的前排词做一个“必定合法”的动作
  if (!plan.length) {
    const u = myFront[0];
    if (u.role === 'verb' && foeTargets.length) plan.push({ unitId: u.cardId, kind: 'skill', target: foeTargets[0].cardId });
    else if (u.role === 'adverb' && verbTarget) plan.push({ unitId: u.cardId, kind: 'skill', target: verbTarget.cardId });
    else if (u.role === 'adjective' && nounTarget) plan.push({ unitId: u.cardId, kind: 'skill', target: nounTarget.cardId });
    else if (u.role === 'noun') plan.push({ unitId: u.cardId, kind: 'skill', target: u.cardId });
    else plan.push({ unitId: u.cardId, kind: 'skill', target: u.cardId }); // 名词自保兜底(其他角色也允许自保免报错)
  }

  // 逐个尝试计划项，取第一个能成功执行的（避免 AI 空过）
  for (const p of plan) {
    try {
      if (p.kind === 'revive') {
        const out = BL.tryRevive(snap, 1, p.unitId, p.ok ?? true);
        snap.log.push('🤖 ' + out.log);
      } else {
        const out = BL.useFrontSkill(snap, 1, p.unitId, p.target ?? null);
        snap.log.push('🤖 ' + out.log);
      }
      return;
    } catch (e: any) {
      // 该计划不可用 → 试下一个
    }
  }
  // 所有计划都失败：用第一个未出手的前排词做「确保合法」的动作
  const fu = myFront[0];
  try {
    if (fu.role === 'verb' && foeTargets.length) {
      BL.useFrontSkill(snap, 1, fu.cardId, foeTargets[0].cardId);
    } else if (fu.role === 'noun' && !fu.shieldBroken) {
      BL.useFrontSkill(snap, 1, fu.cardId, fu.cardId);
    } else {
      // 其余情况：直接标记已出手，避免无限空过占位
      fu.usedSkill = true;
    }
    snap.log.push(`🤖 ${fu.word} 待命`);
  } catch (e: any) {
    fu.usedSkill = true;
  }
}

export { BL };
