/**
 * 金币场阵容人数 + 布阵预览 + 残留布阵顺序 测试（2026-09-18）
 *
 * ① 建房/坐下：健康词 < 档位所需 → 拒绝
 * ② 布阵预览 myTroop 长度 == 档位人数（10→3 / 30→4 / 50→5 / 100→7 / 200→10）
 * ③ 同一用户连打多局（复用房间号）布阵人数不串味（deployOrders 泄漏回归）
 *
 * 用法：cd server-ts && node scripts/_gold_deploy_scale_test.cjs
 */
const fs = require('fs');
const path = require('path');
const LOG = path.join(__dirname, '_gold_deploy_scale_test.log');
if (fs.existsSync(LOG)) fs.unlinkSync(LOG);
const out = fs.createWriteStream(LOG, { encoding: 'utf8' });
const log = (...a) => out.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; log('  OK  ' + label); }
  else { fail++; log('  FAIL ' + label + (extra !== undefined ? ' | got: ' + JSON.stringify(extra) : '')); }
}
const BASE = 'http://127.0.0.1:3000/api';
async function api(p, opts = {}, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { ...opts, headers });
  const t = await res.text();
  try { return JSON.parse(t); } catch (_) { return { raw: t, status: res.status }; }
}
async function login(u, p) {
  const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
  return (r.data && r.data.token) || null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIER = { 10: 3, 30: 4, 50: 5, 100: 7, 200: 10 };

/** 建房→c 坐下→双方准备→进入布阵，返回双方视角的 myTroop 长度 */
async function runOneRoom(tA, tB, bet) {
  const c = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet }) }, tA);
  if (c.code !== 200) return { created: false, msg: c.msg };
  const rid = c.data.room.id;
  const j = await api('/battle/room/' + rid + '/join', { method: 'POST', body: '{}' }, tB);
  const r1 = await api('/battle/room/' + rid + '/ready', { method: 'POST', body: JSON.stringify({ ready: true }) }, tA);
  const r2 = await api('/battle/room/' + rid + '/ready', { method: 'POST', body: JSON.stringify({ ready: true }) }, tB);
  await sleep(500);
  const vA = await api('/battle/room/' + rid, {}, tA);
  const vB = await api('/battle/room/' + rid, {}, tB);
  const rmA = vA.data && vA.data.room;
  const rmB = vB.data && vB.data.room;
  const res = {
    created: true, rid,
    joinCode: j.code,
    readyA: r1.code, readyB: r2.code,
    statusA: rmA && rmA.status, statusB: rmB && rmB.status,
    troopA: ((rmA && rmA.myTroop) || []).length,
    troopB: ((rmB && rmB.myTroop) || []).length,
  };
  // 清理（离开 → 房间取消退押）
  await api('/battle/room/' + rid + '/leave', { method: 'POST', body: JSON.stringify({ reason: 'leave' }) }, tA);
  await api('/battle/room/' + rid + '/leave', { method: 'POST', body: JSON.stringify({ reason: 'leave' }) }, tB);
  return res;
}

(async () => {
  const tChang = await login('chang', 'cjy123com'); // 10 词
  const tSprite = await login('sprite', 'cjy123com'); // 5 词
  ok(!!tChang && !!tSprite, '两个账号登录');

  log('\n=== ① 健康词不足档位 → 建房/坐下都被拒 ===');
  for (const [bet, need] of Object.entries(TIER)) {
    const b = Number(bet);
    if (need <= 5) continue; // sprite 5 词，这些档够
    const r = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet: b }) }, tSprite);
    ok(r.code !== 200, `sprite(5词) 建房 bet=${b}（需${need}）被拒`, r.code);
  }
  // 坐下别人的高档房
  {
    const c = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet: 200 }) }, tChang);
    ok(c.code === 200, 'chang 开 200 房');
    if (c.code === 200) {
      const rid = c.data.room.id;
      const j = await api('/battle/room/' + rid + '/join', { method: 'POST', body: '{}' }, tSprite);
      ok(j.code !== 200, 'sprite(5词) 坐下 200 房被拒', j.code);
      log('    拒绝文案: ' + j.msg);
      await api('/battle/room/' + rid + '/leave', { method: 'POST', body: JSON.stringify({ reason: 'leave' }) }, tChang);
    }
  }

  log('\n=== ② 布阵预览人数 == 档位人数 ===');
  for (const [bet, need] of Object.entries(TIER)) {
    const b = Number(bet);
    if (need > 10) continue;
    const A = need <= 5 ? tSprite : tChang;
    const B = need <= 5 ? tChang : tSprite;
    // 保证两人都够：need<=5 时 sprite(5)+chang(10) 都够；need=7/10 时 sprite 不够，用 chang vs chang 不行（不能自己坐下）
    if (need > 5) {
      // 只有 chang 够 -> 跳过（缺第二个够词的账号）
      log('  （bet=' + b + ' 需 ' + need + ' 词，只有一个账号够，跳过布阵验证）');
      continue;
    }
    const r = await runOneRoom(A, B, b);
    log('  bet=' + b + ' -> status=' + r.statusA + ' troopA=' + r.troopA + ' troopB=' + r.troopB);
    ok(r.statusA === 'deploy', `bet=${b} 进入布阵`);
    ok(r.troopA === need, `bet=${b} 房主布阵人数 = ${need}`);
    ok(r.troopB === need, `bet=${b} 对手布阵人数 = ${need}`);
  }

  log('\n=== ③ 连续多局不串味（deployOrders 泄漏回归）===');
  {
    const r1 = await runOneRoom(tSprite, tChang, 10); // 3 词
    const r2 = await runOneRoom(tSprite, tChang, 50); // 5 词
    const r3 = await runOneRoom(tSprite, tChang, 10); // 3 词
    log('  局1(10) troopA=' + r1.troopA + ' / 局2(50) troopA=' + r2.troopA + ' / 局3(10) troopA=' + r3.troopA);
    ok(r1.troopA === 3, '局1 bet=10 → 3 词');
    ok(r2.troopA === 5, '局2 bet=50 → 5 词（没被上局的 3 词污染）');
    ok(r3.troopA === 3, '局3 bet=10 → 3 词（没被上局的 5 词污染）');
  }

  log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
  out.end();
  setTimeout(() => { console.log('pass=' + pass + ' fail=' + fail + ' log=' + LOG); process.exit(fail ? 1 : 0); }, 200);
})();
