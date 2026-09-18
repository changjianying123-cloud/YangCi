/**
 * 逃跑功能测试（2026-09-18）
 *  ① AI 场：逃跑 → 判负（winner=1，reason 含「逃跑」）
 *  ② AI 场：已结束的对局再逃跑 → 幂等（不改胜负）
 *  ③ 金币场（房间制）：逃跑 → 判负、对手拿底池、房间 finished
 *
 * 用法：cd server-ts && node scripts/_flee_test.cjs
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const LOG = path.join(__dirname, '_flee_test.log');
if (fs.existsSync(LOG)) fs.unlinkSync(LOG);
const out = fs.createWriteStream(LOG, { encoding: 'utf8' });
const log = (...a) => out.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
function ok(c, l, e) { if (c) { pass++; log('  OK  ' + l); } else { fail++; log('  FAIL ' + l + (e !== undefined ? ' | ' + JSON.stringify(e) : '')); } }
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
const cfg = { host: '127.0.0.1', user: 'root', password: 'cjy123com', database: 'word_app' };

(async () => {
  const tChang = await login('chang', 'cjy123com');
  const tSprite = await login('sprite', 'cjy123com');
  ok(!!tChang && !!tSprite, '账号登录');

  log('\n=== ① AI 场逃跑 ===');
  {
    const s = await api('/battle/ai/start', { method: 'POST', body: JSON.stringify({ spellMode: 'zh-spell' }) }, tChang);
    ok(s.code === 200, 'AI 场开局', s.msg);
    const bid = s.data.battleId;
    const f = await api(`/battle/${bid}/forfeit`, { method: 'POST', body: '{}' }, tChang);
    log('  forfeit -> code=' + f.code + ' over=' + (f.data && f.data.snap && f.data.snap.over) + ' winner=' + (f.data && f.data.snap && f.data.snap.winner) + ' reason=' + (f.data && f.data.snap && f.data.snap.reason));
    ok(f.code === 200, '逃跑接口 200', f.msg);
    const sn = f.data && f.data.snap;
    ok(sn && sn.over === true, '对局结束');
    ok(sn && sn.winner === 1, '判我方负 (winner=1)', sn && sn.winner);
    ok(sn && /逃跑/.test(String(sn.reason)), 'reason 含「逃跑」', sn && sn.reason);

    log('\n=== ② 幂等：已结束再逃跑 ===');
    const f2 = await api(`/battle/${bid}/forfeit`, { method: 'POST', body: '{}' }, tChang);
    ok(f2.code === 200, '重复逃跑仍 200');
    ok(f2.data && f2.data.snap && f2.data.snap.winner === 1, '胜负不变 (winner=1)');

    log('\n=== ② b. 权属：别人不能逃我的局 ===');
    const f3 = await api(`/battle/${bid}/forfeit`, { method: 'POST', body: '{}' }, tSprite);
    ok(f3.code !== 200, '他人逃跑被拒', f3.code);
  }

  log('\n=== ③ 金币场（房间制）逃跑 ===');
  const conn = await mysql.createConnection(cfg);
  try {
    // 记录开局前金币
    const [[uC0]] = await conn.query('SELECT coins FROM users WHERE username = ?', ['chang']);
    const [[uS0]] = await conn.query('SELECT coins FROM users WHERE username = ?', ['sprite']);
    const bet = 50;
    log(`  开局前: chang=${uC0.coins} sprite=${uS0.coins} 押注=${bet}`);

    const c = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet }) }, tChang);
    ok(c.code === 200, 'chang 建房', c.msg);
    const rid = c.data.room.id;
    const j = await api(`/battle/room/${rid}/join`, { method: 'POST', body: '{}' }, tSprite);
    ok(j.code === 200, 'sprite 坐下', j.msg);
    const r1 = await api(`/battle/room/${rid}/ready`, { method: 'POST', body: JSON.stringify({ ready: true }) }, tChang);
    const r2 = await api(`/battle/room/${rid}/ready`, { method: 'POST', body: JSON.stringify({ ready: true }) }, tSprite);
    ok(r1.code === 200 && r2.code === 200, '双方准备 → 布阵/开战', { r1: r1.code, r2: r2.code });
    await sleep(800);

    // 双方都提交布阵 → 才真正开战（生成 battle_id）
    const vA = await api(`/battle/room/${rid}`, {}, tChang);
    const vB = await api(`/battle/room/${rid}`, {}, tSprite);
    const troopA = ((vA.data && vA.data.room && vA.data.room.myTroop) || []).map((u) => u.cardId);
    const troopB = ((vB.data && vB.data.room && vB.data.room.myTroop) || []).map((u) => u.cardId);
    ok(troopA.length > 0 && troopB.length > 0, '双方拿到布阵名单', { a: troopA.length, b: troopB.length });
    const d1 = await api(`/battle/room/${rid}/deploy`, { method: 'POST', body: JSON.stringify({ order: troopA }) }, tChang);
    const d2 = await api(`/battle/room/${rid}/deploy`, { method: 'POST', body: JSON.stringify({ order: troopB }) }, tSprite);
    log('  deploy: chang=' + d1.code + ' sprite=' + d2.code);
    await sleep(600);

    // 取战斗 id
    const [roomRow] = await conn.query('SELECT battle_id, status FROM battle_rooms WHERE id = ?', [rid]);
    log('  room: ' + JSON.stringify(roomRow[0]));
    const bid = roomRow[0].battle_id;
    if (!bid) { ok(false, '房间已开战（有 battle_id）', roomRow[0]); }
    else {
      // chang 逃跑
      const f = await api(`/battle/${bid}/forfeit`, { method: 'POST', body: '{}' }, tChang);
      log('  chang forfeit -> code=' + f.code + ' snap.over=' + (f.data && f.data.snap && f.data.snap.over) + ' winner=' + (f.data && f.data.snap && f.data.snap.winner));
      ok(f.code === 200, '金币场逃跑 200', f.msg);
      await sleep(500);

      const [roomAfter] = await conn.query('SELECT status, winner_user_id, bet FROM battle_rooms WHERE id = ?', [rid]);
      log('  房间终态: ' + JSON.stringify(roomAfter[0]));
      ok(roomAfter[0].status === 'finished', '房间 finished');
      // sprite(id=16) 应赢底池
      const [[uS1]] = await conn.query('SELECT coins FROM users WHERE username = ?', ['sprite']);
      const [[uC1]] = await conn.query('SELECT coins FROM users WHERE username = ?', ['chang']);
      log(`  开局后: chang=${uC1.coins} sprite=${uS1.coins}`);
      const expectS = uS0.coins - bet + bet * 2; // 未扣押时=原值-押注+底池
      const expectC = uC0.coins - bet;
      log(`  期望(未扣押口径): chang=${expectC} sprite=${expectS}`);
      ok(uS1.coins > uS0.coins, 'sprite 金币增加（赢了底池）', { before: uS0.coins, after: uS1.coins });
      ok(uC1.coins < uC0.coins, 'chang 金币减少（输了押注）', { before: uC0.coins, after: uC1.coins });
      const winnerUid = roomAfter[0].winner_user_id;
      const [[spriteRow]] = await conn.query('SELECT id FROM users WHERE username = ?', ['sprite']);
      ok(winnerUid === spriteRow.id, 'winner_user_id = sprite', { winnerUid, sprite: spriteRow.id });
    }
  } finally {
    await conn.end();
  }

  log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
  out.end();
  setTimeout(() => { console.log('pass=' + pass + ' fail=' + fail + ' log=' + LOG); process.exit(fail ? 1 : 0); }, 300);
})();
