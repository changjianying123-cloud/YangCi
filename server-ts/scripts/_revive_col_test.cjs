/**
 * 复活回原列测试（本次修复）
 * 问题：cleanupQueue 已把阵亡单位从 cols 移除 -> tryRevive 里 indexOf 找不到原列
 *      -> 复活单位跑到"人少的列"，可能与阵亡前所在列不同，导致玩家看到的队列错乱。
 * 修复：cleanupQueue 移除时记录 u.origCol；tryRevive 优先回 origCol。
 *
 * 用法：cd server-ts && node scripts/_revive_col_test.cjs
 */
const fs = require('fs');
const path = require('path');
const BL = require(path.join(__dirname, '..', '.scratch', 'twocol', 'utils', 'battleLogic.js'));

const LOG = path.join(__dirname, '_revive_col_test.log');
if (fs.existsSync(LOG)) fs.unlinkSync(LOG);
const out = fs.createWriteStream(LOG, { encoding: 'utf8' });
const log = (...a) => out.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; log('  OK  ' + label); } else { fail++; log('  FAIL ' + label); } }

function U(id, word, role) {
  return { cardId: id, wordId: id, word, meaning: '', role, level: 1, maxHp: 1, hp: 1, atkBuff: 0, shield: 0, shieldBuff: 0, dead: false, usedSkill: false, revived: false };
}
function mkSnap(order, units) {
  const c0 = []; const c1 = [];
  order.forEach((id, i) => { (i % 2 === 0 ? c0 : c1).push(id); });
  return {
    turn: 1, currentSide: 0, over: false, winner: null, reason: '', mode: 'rookie', spellMode: 'en-spell',
    player: { userId: 1, nickname: 'me', units, cols: [c0, c1], queue: c0.concat(c1) },
    enemy: { userId: -1, nickname: 'AI', units: [U(1, 'e1', 'verb')], cols: [[1], []], queue: [1] },
    log: [],
  };
}

// ---- 用例 1：左列单位阵亡后复活，应回到左列 ----
log('=== 1) 左列单位阵亡 -> 复活回左列 ===');
{
  // 左列 = [10, 30, 50]，右列 = [20, 40]
  const units = [U(10, 'a', 'verb'), U(20, 'b', 'verb'), U(30, 'c', 'verb'), U(40, 'd', 'verb'), U(50, 'e', 'verb')];
  const snap = mkSnap([10, 20, 30, 40, 50], units);
  const t = units.find((u) => u.cardId === 10);
  t.dead = true;
  BL.cleanupQueue(snap.player);
  log('  阵亡后 cols=' + JSON.stringify(snap.player.cols) + '  origCol(10)=' + t.origCol);
  ok(t.origCol === 0, 'origCol 记录为 0（左列）');
  ok(JSON.stringify(snap.player.cols) === JSON.stringify([[30, 50], [20, 40]]), '左列已移除 10');
  const r = BL.tryRevive(snap, 0, 10, true);
  log('  ' + r.log);
  ok(snap.player.cols[0].indexOf(10) >= 0, '10 复活回到左列');
  ok(snap.player.cols[1].indexOf(10) < 0, '10 不在右列');
  ok(!t.origCol, 'origCol 已清除');
}

// ---- 用例 2：右列单位阵亡后复活，应回到右列（右列人更少也回右列）----
log('=== 2) 右列单位阵亡 -> 复活回右列（即使右列人少）===');
{
  const units = [U(10, 'a', 'verb'), U(20, 'b', 'verb'), U(30, 'c', 'verb'), U(40, 'd', 'verb'), U(50, 'e', 'verb')];
  const snap = mkSnap([10, 20, 30, 40, 50], units);
  const t = units.find((u) => u.cardId === 40);
  t.dead = true;
  BL.cleanupQueue(snap.player);
  log('  阵亡后 cols=' + JSON.stringify(snap.player.cols) + '  origCol(40)=' + t.origCol);
  ok(t.origCol === 1, 'origCol 记录为 1（右列）');
  const r = BL.tryRevive(snap, 0, 40, true);
  log('  ' + r.log);
  ok(snap.player.cols[1].indexOf(40) >= 0, '40 复活回到右列');
  ok(snap.player.cols[0].indexOf(40) < 0, '40 不在左列');
}

// ---- 用例 3：右列全灭后复活，仍应回右列（修复前会跑去左列）----
log('=== 3) 右列全灭 -> 复活一个仍回右列（修复前会跑左列）===');
{
  const units = [U(10, 'a', 'verb'), U(20, 'b', 'verb'), U(30, 'c', 'verb'), U(40, 'd', 'verb'), U(50, 'e', 'verb')];
  const snap = mkSnap([10, 20, 30, 40, 50], units);
  units.find((u) => u.cardId === 20).dead = true;
  units.find((u) => u.cardId === 40).dead = true;
  BL.cleanupQueue(snap.player);
  log('  右列全灭后 cols=' + JSON.stringify(snap.player.cols));
  const r = BL.tryRevive(snap, 0, 40, true);
  log('  ' + r.log);
  ok(snap.player.cols[1].indexOf(40) >= 0, '40 回右列（而不是人少的左列）');
}

// ---- 用例 4：旧存档（无 origCol）仍能复活（退回原逻辑）----
log('=== 4) 旧存档无 origCol 仍能复活 ===');
{
  const units = [U(10, 'a', 'verb'), U(20, 'b', 'verb'), U(30, 'c', 'verb'), U(40, 'd', 'verb'), U(50, 'e', 'verb')];
  const snap = mkSnap([10, 20, 30, 40, 50], units);
  const t = units.find((u) => u.cardId === 10);
  t.dead = true;
  // 模拟旧存档：cols 里还留着 10（未 cleanup），也没有 origCol
  // 然后直接 tryRevive：indexOf 能找到 -> 回左列
  const r = BL.tryRevive(snap, 0, 10, true);
  log('  ' + r.log);
  ok(snap.player.cols[0].indexOf(10) >= 0, '旧存档：10 回左列');
}

// ---- 用例 5：复活失败不应记录/污染 origCol ----
log('=== 5) 复活失败不改队列 ===');
{
  const units = [U(10, 'a', 'verb'), U(20, 'b', 'verb'), U(30, 'c', 'verb'), U(40, 'd', 'verb'), U(50, 'e', 'verb')];
  const snap = mkSnap([10, 20, 30, 40, 50], units);
  units.find((u) => u.cardId === 10).dead = true;
  BL.cleanupQueue(snap.player);
  const before = JSON.stringify(snap.player.cols);
  const r = BL.tryRevive(snap, 0, 10, false);
  log('  ' + r.log);
  ok(JSON.stringify(snap.player.cols) === before, '失败后 cols 不变');
}

log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
out.end();
setTimeout(() => { console.log('pass=' + pass + ' fail=' + fail + ' log=' + LOG); process.exit(fail ? 1 : 0); }, 200);
