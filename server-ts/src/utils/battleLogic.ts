import { BattleRole, BattleSnapshot, BattleUnit } from '../types';

// ===== 单词对战：纯战斗逻辑（无 I/O，便于单测 & 将来服务端裁决复用）=====

export const TURN_SECONDS = 30;
export const FRONT_SIZE = 2;     // 可行动行数：两列模型下每方「前两行」可行动
export const NPCS_FRONT = 2;     // 可被攻击的行数（= 前两行）
export const TROOP_SIZE = 5;     // 每边默认出征数量
// 两列模型：左列=我方，右列=敌方，每列纵向排列 5 个单词位。
// 「前两行」为一线（可行动 / 可被攻击），其余为后备行。
export const AI_ACTS_PER_TURN = 2;  // AI 每回合最多让 2 个一线单词行动（与玩家前两行对齐）
export const MAX_TURNS = 60;     // 硬性回合上限：打满按剩余兵力判定，防无限拉锯

/** 主角色(词性)在战斗中被使用的定位 */
export function roleOf(u: BattleUnit): BattleRole {
  return u.role; // 组队时由系统从多词性中选定唯一 role
}

// ---------- 数值 ----------

/** 血量字段仍保留供前端展示，但一击必杀制下不再参与战斗数值 */
export function maxHpFor(level: number, role: BattleRole): number {
  const base = level * 15 + 30;
  return role === 'noun' ? Math.round(base * 1.5) : base;
}

export const ATK_BUFF_CAP = 3;    // 副词叠加上限（每层=破盾时穿透击杀）
export const SHIELD_CAP = 3;      // 单名词护盾上限层（=能承受的攻击次数/命）

// ---------- 工具 ----------

export function standingQueue(side: { queue: number[]; units: BattleUnit[] }): number[] {
  // 站立队列 = 未阵亡单位的顺序（防御死亡间隙，确保“前移”）
  return side.queue.filter((id) => {
    const u = side.units.find((x) => x.cardId === id);
    return u && !u.dead;
  });
}

export function findUnit(side: { units: BattleUnit[] }, cardId: number): BattleUnit | undefined {
  return side.units.find((x) => x.cardId === cardId);
}

/** 我方 front 单位（站立队首，至多 FRONT_SIZE 个，全部可行动） */
export function frontUnits(side: { queue: number[]; units: BattleUnit[] }): BattleUnit[] {
  return standingQueue(side)
    .slice(0, FRONT_SIZE)
    .map((id) => findUnit(side, id)!)
    .filter(Boolean);
}

/** 敌方可攻击目标：敌方站立队首前2个 */
export function attackableTargets(side: { queue: number[]; units: BattleUnit[] }): BattleUnit[] {
  return standingQueue(side)
    .slice(0, NPCS_FRONT)
    .map((id) => findUnit(side, id)!)
    .filter(Boolean);
}

/** 出站单位排位方向信息（给前端渲染槽位用） */
export function unitPosition(side: { queue: number[]; units: BattleUnit[] }, cardId: number): 'front' | 'back' | 'dead' {
  const u = findUnit(side, cardId);
  if (!u || u.dead) return 'dead';
  const sq = standingQueue(side);
  const idx = sq.indexOf(cardId);
  if (idx < 0) return 'dead';
  return idx < FRONT_SIZE ? 'front' : 'back';
}

// ---------- 阵亡/复活 ----------

/** 可否复活：阵亡 且 发动过技能=false 且 本局还没复活过 */
export function canRevive(u: BattleUnit): boolean {
  return u.dead && !u.usedSkill && !u.revived;
}

// ---------- 攻击结算（一击必杀制：无血量，屏障=命）----------

/**
 * 攻击结算(动词攻击 target)。一击必杀制：
 *   - 目标有屏障(shield>0)：消耗 1 层屏障，本次**不阵亡**；并标记 shieldBroken（本回合不能再续盾）。
 *   - 目标无屏障：**直接阵亡**（一击必杀）。
 *   （副词加成保留：有加成时破盾额外“击穿”——仍直接击杀，用于体现副词的价值）
 * 返回是否破盾 & 目标是否阵亡。
 */
export function applyAttack(attacker: BattleUnit, target: BattleUnit): { damage: number; brokeShield: boolean; killed: boolean } {
  let brokeShield = false;
  let killed = false;
  if (target.shield > 0) {
    target.shield -= 1;
    brokeShield = true;
    target.shieldBroken = true; // 破盾后本回合内不能再被续盾
    // 副词加成 = 穿透：破盾的同时直接击杀
    if (attacker.atkBuff > 0) {
      target.dead = true;
      killed = true;
    }
  } else {
    // 无屏障 → 一击必杀
    target.dead = true;
    killed = true;
  }
  target.hp = target.dead ? 0 : (target.maxHp || 1);
  return { damage: killed ? 1 : 0, brokeShield, killed };
}

// ---------- 行动：词性技能 ----------

export type SkillOutcome = {
  log: string;
  damage?: number;
  brokeShield?: boolean;
  killed?: boolean;
  shieldedCardId?: number;
  buffedCardId?: number;
};

/**
 * 我方某 front 单位发动一次技能(拼写正确) 后结算。
 * attackerIndex/cardId 的 front 单位，targetCardId 为敌方前排目标(仅动词攻击需要)。
 */
export function useFrontSkill(
  snap: BattleSnapshot,
  sideIdx: 0 | 1,
  unitCardId: number,
  targetCardId?: number | null
): SkillOutcome {
  const me = sideIdx === 0 ? snap.player : snap.enemy;
  const foe = sideIdx === 0 ? snap.enemy : snap.player;
  const u = findUnit(me, unitCardId);
  if (!u) throw new Error('单词不存在');
  if (u.dead) throw new Error('该单词已阵亡');
  // 必须在前排
  const sq = standingQueue(me);
  if (sq.indexOf(unitCardId) < 0 || sq.indexOf(unitCardId) >= FRONT_SIZE) {
    throw new Error('只有前排单词能行动');
  }

  // 先结算技能
  let outcome: SkillOutcome = { log: '' };
  switch (u.role) {
    case 'noun': {
      // 名词：保护自己或某个我方词 —— 叠护盾(1层，上限SHIELD_CAP)
      const targetId = targetCardId || unitCardId;
      const t = findUnit(me, targetId) || u;
      if (t.dead) throw new Error('保护目标已阵亡');
      if (t.shieldBroken) throw new Error(`${t.word} 刚被破盾，本回合无法续盾`);
      t.shield = Math.min(t.shield + 1, SHIELD_CAP);
      u.usedSkill = true;
      outcome = { log: `${u.word}(名词) 为 ${t.word} 增加 1 层护盾`, shieldedCardId: t.cardId };
      break;
    }
    case 'adjective': {
      // 形容词：给目标名词叠护盾（只能加成名词的保人防御）
      // 若全队没名词 → 降级为给自己的前排任意单位叠盾(不浪费行动)
      let t = targetCardId ? findUnit(me, targetCardId) : undefined;
      if (!t || t.dead || t.shieldBroken) t = standingQueue(me).map((id) => findUnit(me, id)).find((x): x is BattleUnit => !!x && !x.shieldBroken && x.role === 'noun');
      if (!t) t = (u.shieldBroken ? undefined : u); // 没有可护名词 → 护自己(自身未被破盾时)
      if (!t) throw new Error('当前没有可续盾的目标（均刚被破盾）');
      if (t.role !== 'noun' && t !== u) throw new Error('形容词只能给名词增加护盾');
      t.shield = Math.min(t.shield + 1, SHIELD_CAP);
      u.usedSkill = true;
      outcome = { log: `${u.word}(形容词) 强化 ${t.word} 的护盾(+1层)`, shieldedCardId: t.cardId };
      break;
    }
    case 'verb': {
      // 动词：攻击敌方前排(队首2个之一)
      const targets = attackableTargets(foe);
      if (!targets.length) throw new Error('对方已没有可攻击目标');
      let t = targets[0];
      if (targetCardId) {
        const pick = findUnit(foe, targetCardId);
        if (pick && !pick.dead && targets.some((x) => x.cardId === pick.cardId)) t = pick;
        else throw new Error('只能攻击敌方最前排的两个单词');
      }
      const r = applyAttack(u, t);
      u.usedSkill = true;
      let dmgTxt: string;
      if (r.killed) dmgTxt = r.brokeShield ? '击破屏障并击杀' : '一击必杀';
      else if (r.brokeShield) dmgTxt = '击破 1 层屏障';
      else dmgTxt = '未命中';
      outcome = {
        log: `${u.word}(动词) 攻击 ${t.word}，${dmgTxt}${r.killed ? `，${t.word} 阵亡！` : ''}`,
        damage: r.damage, brokeShield: r.brokeShield, killed: r.killed,
      };
      break;
    }
    case 'adverb': {
      // 副词：给目标动词 +1 层攻击；若全队没动词 → 降级为给自己叠盾(不浪费行动)
      let t = targetCardId ? findUnit(me, targetCardId) : undefined;
      if (!t || t.dead) t = standingQueue(me).map((id) => findUnit(me, id)).find((x): x is BattleUnit => !!x && x.role === 'verb');
      if (!t) {
        // 无动词可强化：降级为给自身叠盾
        u.shield = Math.min(u.shield + 1, SHIELD_CAP);
        u.usedSkill = true;
        outcome = { log: `${u.word}(副词) 无动词可强化，改为自身 +1 层护盾`, shieldedCardId: u.cardId };
        break;
      }
      if (t.role !== 'verb') throw new Error('副词只能强化动词的攻击');
      t.atkBuff = Math.min(t.atkBuff + 1, ATK_BUFF_CAP);
      u.usedSkill = true;
      outcome = { log: `${u.word}(副词) 强化 ${t.word} 的攻击力(+1层)`, buffedCardId: t.cardId };
      break;
    }
    default:
      throw new Error('未知词性');
  }

  // 行动单位退到后排队尾
  moveToBack(me, unitCardId);

  // 阵亡后清理队列
  cleanupQueue(me);
  cleanupQueue(foe);

  return outcome;
}
/** 行动单位出手后退到「后排」待命（同回合内不再轮到它）。
 *  两列模型：前排=本回合可行动列，后排=本回合已出手/待命列。
 *  具体做法：将该词从排队列中移到「所有未出手单位之后」，这样前排空位会由后排未出手的词补上。 */
export function moveToBack(side: { queue: number[]; units: BattleUnit[] }, cardId: number) {
  const sq = standingQueue(side);
  if (sq.indexOf(cardId) < 0) return;
  const rest = sq.filter((id) => id !== cardId);
  // 分为：未出手的（优先留在前面） vs 已出手的
  const pending = rest.filter((id) => {
    const u = findUnit(side, id);
    return u && !u.dead && !u.usedSkill;
  });
  const done = rest.filter((id) => !pending.includes(id));
  side.queue = [...pending, ...done, cardId];
}

/** 回合末：把所有未阵亡单位按当前排队重排，预备下一回合
 *  （前排=队列前 FRONT_SIZE 个；理论上此时 usedSkill 已全部重置） */
export function promoteBackline(side: { queue: number[]; units: BattleUnit[] }) {
  // 保持队列顺序即可；真正的“前排满员”由回合末 resetTurnFlags + 队列顺序保证
  side.queue = standingQueue(side);
}

/** 回合末重置所有存活单位的「本回合已出手」标记，让它们下一回合能再次行动 */
export function resetTurnFlags(side: { queue: number[]; units: BattleUnit[] }) {
  for (const u of side.units) {
    if (!u.dead) {
      u.usedSkill = false;
      u.shieldBroken = false;
    }
  }
}

/** 清理队列：去掉已阵亡单位(死亡自动前排前移/remove) */
export function cleanupQueue(side: { queue: number[]; units: BattleUnit[] }) {
  side.queue = side.queue.filter((id) => {
    const u = side.units.find((x) => x.cardId === id);
    return u && !u.dead;
  });
}

/** 尝试复活一个“可复活”单位(作为行动)：拼写正确→复活回队尾；错误→彻底消失(该词本局无法再复活但不删 units,只移出队列并 dead=true,revived 置为阻复) */
export function tryRevive(
  snap: BattleSnapshot,
  sideIdx: 0 | 1,
  revivedCardId: number,
  spellCorrect: boolean
): SkillOutcome {
  const me = sideIdx === 0 ? snap.player : snap.enemy;
  const u = findUnit(me, revivedCardId);
  if (!u) throw new Error('该单词不在阵亡列');
  if (!canRevive(u)) throw new Error('该单词不可复活');

  if (!spellCorrect) {
    // 拼写失败 → 复活失败，本局不可再尝试复活它
    u.usedSkill = false;
    u.revived = true; // 标记为“已结算复活”，不可再复活
    return { log: `复活 ${u.word} 失败，它彻底阵亡了` };
  }
  // 成功：回部队(加回站立队尾=最后排)。一击必杀制下复活单位无屏障，随时可能再被秒
  u.dead = false;
  u.revived = true;
  u.usedSkill = true; // 以后就算再阵亡也不可复活(已经用过一次复活机会)
  u.hp = u.maxHp || 1;
  me.queue.push(u.cardId);
  return { log: `${u.word} 拼写正确，成功复活！(无屏障，回到队尾)` };
}

// ---------- 胜负判定 ----------

/** 打满回合的兜底决胜：一击必杀制下按剩余存活数 + 总护盾层数判定；仍平就判玩家胜 */
export function suddenDeath(snap: BattleSnapshot): void {
  const score = (side: { queue: number[]; units: BattleUnit[] }) => {
    const alive = standingQueue(side).map((id) => findUnit(side, id)!);
    const shield = alive.reduce((s, u) => s + (u.shield || 0), 0);
    return { count: alive.length, shield };
  };
  const P = score(snap.player);
  const E = score(snap.enemy);
  let w: number;
  if (P.count !== E.count) w = P.count > E.count ? 0 : 1;
  else if (P.shield !== E.shield) w = P.shield > E.shield ? 0 : 1;
  else w = 0; // 平手偏向玩家(面对 AI 宽容处理)
  snap.over = true;
  snap.winner = w;
  snap.reason = `回合打满(${MAX_TURNS})，按剩余兵力判定：${snap.player.nickname} ${w === 0 ? '获胜' : '落败'}`;
  snap.log.push('⏱️ 回合数到上限，按剩余兵力决胜');
}

/** 某方是否还有站立(未阵亡)单位 */
export function hasStanding(side: { queue: number[]; units: BattleUnit[] }): boolean {
  return standingQueue(side).length > 0;
}

/** 是否有攻击手(动词)可造成伤害 */
export function hasVerb(side: { queue: number[]; units: BattleUnit[] }): boolean {
  return standingQueue(side)
    .map((id) => findUnit(side, id)!)
    .some((u) => u.role === 'verb');
}

/**
 * 保底攻击手：若全队没有任何动词(攻击手)，把第一个存活单位“兼职”成动词，
 * 保证只要有健康单词就能开打，不会一开场就因无动词自动判负。
 * 已存在动词时不做任何改动。
 */
export function ensureVerb(side: { queue: number[]; units: BattleUnit[] }): void {
  if (hasVerb(side)) return;
  const first = standingQueue(side)
    .map((id) => findUnit(side, id))
    .find((u): u is BattleUnit => !!u && !u.dead);
  if (!first) return;
  first.role = 'verb';
}

/**
 * 每回合后根据规则判断是否分出胜负 / 是否需要判负。
 * 返回 reason 字符串 or null(战斗继续) */
export function checkEnd(snap: BattleSnapshot): { winner: number | null; reason: string } | null {
  const pAlive = hasStanding(snap.player);
  const eAlive = hasStanding(snap.enemy);
  if (!pAlive) return { winner: 1, reason: '我方全部阵亡，敌方获胜' };
  if (!eAlive) return { winner: 0, reason: '敌方全部阵亡，我方获胜' };
  // 注：不再因为“没有动词”而直接判负。动词阵亡后由 ensureVerb 在回合末自动推举新攻击手，
  // 只有两边都确实没兵时才会结束，避免“刚开打就秒输”的挫败感。
  return null;
}

/** 回合末保底：为双方各自补一个攻击手(动词)，避免无动词就卡成平局/判负 */
export function ensureVerbs(snap: BattleSnapshot): void {
  ensureVerb(snap.player);
  ensureVerb(snap.enemy);
}

/** 进攻方回合是否因“场上无动词/全灭”等而应提前结束 */
export function scanAutoEnd(snap: BattleSnapshot): void {
  const end = checkEnd(snap);
  if (end) {
    snap.over = true;
    snap.winner = end.winner;
    snap.reason = end.reason;
  }
}

/** 是否为该侧玩家的回合可行动 */
export function isMyTurn(snap: BattleSnapshot, sideIdx: 0 | 1): boolean {
  return !snap.over && snap.currentSide === sideIdx;
}
