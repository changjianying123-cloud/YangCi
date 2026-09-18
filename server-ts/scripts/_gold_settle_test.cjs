/**
 * 金币场（房间制）结算测试：
 *  ① 两个用户开房 → 都准备 → 都布阵 → 开战
 *  ② 强制一方全灭 → 等扫描器结算
 *  ③ 校验：赢家金币 = 初始 - bet + pot ；输家 = 初始 - bet
 *  ④ 校验：room.status=finished, winner_user_id 正确
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BASE = 'http://127.0.0.1:3000/api';
const LOG = path.join(__dirname, '_gold_settle_test.log');
const out = fs.createWriteStream(LOG, { flags: 'w' });
let pass = 0, fail = 0;
const log = (s) => out.write(s + '\n');
function ok(name, cond, extra) {
  if (cond) { pass++; log(`  ✓ ${name}`); }
  else { fail++; log(`  ✗ ${name} | got: ${JSON.stringify(extra)}`); }
}
async function api(p, opts = {}, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { ...opts, headers });
  const t = await res.text();
  try { return JSON.parse(t); } catch (_) { return { raw: t, status: res.status }; }
}
const cfg = { host: '127.0.0.1', user: 'root', password: 'cjy123com', database: 'word_app' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mkUser(conn, tag) {
  const uname = tag + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100);
  const reg = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username: uname, password: 'test123456', nickname: tag }) });
  const uid = reg.data.user.id;
  const token = reg.data.token;
  const now = Date.now();
  const [words] = await conn.query(`SELECT id, pos FROM words WHERE pos IS NOT NULL AND pos<>'' ORDER BY id LIMIT 40`);
  const picked = []; const seen = new Set();
  for (const w of words) { if (!seen.has(w.pos) || picked.length < 8) { picked.push(w); seen.add(w.pos); } if (picked.length >= 12) break; }
  // 保底 12 张（否则 9 张不够 10 档）
  if (picked.length < 12) { for (const w of words) { if (!picked.includes(w)) picked.push(w); if (picked.length >= 12) break; } }
  for (const w of picked) await conn.execute(`INSERT INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end, feed_spell_count, play_count, play_correct_count, mood_score, downgrade_count, is_egg, abandoned) VALUES (?,?,3,?,?,0,0,0,10,0,0,0)`, [uid, w.id, now + 9999999, now + 99999999]);
  await conn.execute('UPDATE users SET coins = 1000 WHERE id = ?', [uid]);
  return { uid, token };
}

(async () => {
  log('=== 金币场结算测试 ===');
  const conn = await mysql.createConnection(cfg);
  const A = await mkUser(conn, 'ga');
  const B = await mkUser(conn, 'gb');
  ok('注册两个用户', !!A.token && !!B.token);

  const BET = 10;
  // A 开房
  const create = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet: BET }) }, A.token);
  ok('A 开房成功', create.code === 200, create.msg);
  const roomId = (create.data && (create.data.roomId || (create.data.room && create.data.room.id))) || (create.data && create.data.id);
  ok('拿到 roomId', !!roomId, create.data);

  // B 加入
  const join = await api(`/battle/room/${roomId}/join`, { method: 'POST', body: JSON.stringify({}) }, B.token);
  ok('B 加入房间', join.code === 200, { code: join.code, msg: join.msg });

  // 双方准备
  const r1 = await api(`/battle/room/${roomId}/ready`, { method: 'POST', body: JSON.stringify({}) }, A.token);
  ok('A 准备', r1.code === 200, { code: r1.code, msg: r1.msg });
  const r2 = await api(`/battle/room/${roomId}/ready`, { method: 'POST', body: JSON.stringify({}) }, B.token);
  ok('B 准备（触发扣押押注）', r2.code === 200, { code: r2.code, msg: r2.msg });

  // 检查押注已扣
  const coinA1 = (await conn.execute('SELECT coins FROM users WHERE id=?', [A.uid]))[0][0].coins;
  const coinB1 = (await conn.execute('SELECT coins FROM users WHERE id=?', [B.uid]))[0][0].coins;
  ok('A 已扣押注 1000-10=990', Number(coinA1) === 990, coinA1);
  ok('B 已扣押注 1000-10=990', Number(coinB1) === 990, coinB1);

  // 查房间状态
  const [roomRow] = await conn.execute('SELECT * FROM battle_rooms WHERE id=?', [roomId]);
  const room = roomRow[0];
  ok('房间 escrowed=1', Number(room.escrowed) === 1, room.escrowed);
  ok('房间 status=deploy', room.status === 'deploy', room.status);

  // 布阵：从 roomView 的 myTroop 里取参战卡
  const roomViewA = await api(`/battle/room/${roomId}`, {}, A.token);
  const viewA = roomViewA.data && roomViewA.data.room;
  ok('拿到布阵阵容 myTroop', !!(viewA && viewA.myTroop && viewA.myTroop.length), viewA && viewA.myTroop && viewA.myTroop.length);
  const roomViewB = await api(`/battle/room/${roomId}`, {}, B.token);
  const viewB = roomViewB.data && roomViewB.data.room;
  if (viewA && viewA.myTroop) {
    const dA = await api(`/battle/room/${roomId}/deploy`, { method: 'POST', body: JSON.stringify({ order: viewA.myTroop.map((u) => u.cardId) }) }, A.token);
    ok('A 布阵', dA.code === 200, { code: dA.code, msg: dA.msg });
  }
  if (viewB && viewB.myTroop) {
    const dB = await api(`/battle/room/${roomId}/deploy`, { method: 'POST', body: JSON.stringify({ order: viewB.myTroop.map((u) => u.cardId) }) }, B.token);
    ok('B 布阵（双方完成→开战）', dB.code === 200, { code: dB.code, msg: dB.msg });
  }

  // 等待扫描器把 deploy deadline 触发开战，或直接开战
  let battleId = null;
  for (let i = 0; i < 20; i++) {
    const [rr] = await conn.execute('SELECT status, battle_id FROM battle_rooms WHERE id=?', [roomId]);
    if (rr[0].battle_id) { battleId = rr[0].battle_id; break; }
    await sleep(1000);
  }
  ok('已生成 battle', !!battleId, battleId);
  if (!battleId) { log('无法开战，终止'); await conn.end(); out.end(); console.log('PASS=' + pass + ' FAIL=' + fail); setTimeout(() => process.exit(1), 200); return; }

  // 强制 A 方(side 0) 全灭且已结束 → snap.winner=1 → B 胜（直接置 over，隔离结算逻辑）
  const [bs] = await conn.execute('SELECT state FROM battles WHERE id=?', [battleId]);
  const s0 = JSON.parse(bs[0].state);
  s0.player.units.forEach((u) => { u.dead = true; });
  s0.over = true;
  s0.winner = 1; // 1 = side1 = B(guest) 胜
  s0.reason = '我方全部阵亡，敌方获胜';
  s0.currentSide = 1;
  s0.activeUntil = Date.now() + 30000;
  await conn.execute('UPDATE battles SET state=?, status=?, winner=?, turn_deadline=? WHERE id=?', [JSON.stringify(s0), 'finished', 1, s0.activeUntil, battleId]);
  const [bs2] = await conn.execute('SELECT state FROM battles WHERE id=?', [battleId]);
  const s1 = JSON.parse(bs2[0].state);
  log('  强制后 snap.over=' + s1.over + ' winner=' + s1.winner + ' reason=' + s1.reason);
  ok('A 全灭后 snap.over=true', s1.over === true, s1.over);
  ok('A 全灭后 snap.winner=1(B胜)', s1.winner === 1, s1.winner);

  // 等扫描器结算（每 5s）
  let fin = null;
  for (let i = 0; i < 20; i++) {
    const [rr] = await conn.execute('SELECT * FROM battle_rooms WHERE id=?', [roomId]);
    if (rr[0].status === 'finished') { fin = rr[0]; break; }
    await sleep(1000);
  }
  ok('房间已 finished', !!fin, fin && fin.status);
  if (fin) {
    const coinA2 = (await conn.execute('SELECT coins FROM users WHERE id=?', [A.uid]))[0][0].coins;
    const coinB2 = (await conn.execute('SELECT coins FROM users WHERE id=?', [B.uid]))[0][0].coins;
    log(`  A(uid=${A.uid}) coins ${coinA1} -> ${coinA2} ; room.winner=${fin.winner_user_id}`);
    log(`  B(uid=${B.uid}) coins ${coinB1} -> ${coinB2}`);
    ok('房间 winner_user_id = B', Number(fin.winner_user_id) === B.uid, { winner: fin.winner_user_id, B: B.uid });
    ok('B(赢家) 金币 = 990 + 20 = 1010', Number(coinB2) === 1010, coinB2);
    ok('A(输家) 金币保持 990', Number(coinA2) === 990, coinA2);
  }

  // ---- 场景 2：赢家赢下对局后又退出房间（roomLeave）→ 不能被判负、底池不能给输家 ----
  {
    const C = await mkUser(conn, 'gc');
    const D = await mkUser(conn, 'gd');
    const BET2 = 10;
    const c = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet: BET2 }) }, C.token);
    const rid = (c.data && (c.data.roomId || (c.data.room && c.data.room.id))) || (c.data && c.data.id);
    await api(`/battle/room/${rid}/join`, { method: 'POST', body: JSON.stringify({}) }, D.token);
    await api(`/battle/room/${rid}/ready`, { method: 'POST', body: JSON.stringify({}) }, C.token);
    await api(`/battle/room/${rid}/ready`, { method: 'POST', body: JSON.stringify({}) }, D.token);
    const vC = (await api(`/battle/room/${rid}`, {}, C.token)).data.room;
    const vD = (await api(`/battle/room/${rid}`, {}, D.token)).data.room;
    await api(`/battle/room/${rid}/deploy`, { method: 'POST', body: JSON.stringify({ order: vC.myTroop.map((u) => u.cardId) }) }, C.token);
    await api(`/battle/room/${rid}/deploy`, { method: 'POST', body: JSON.stringify({ order: vD.myTroop.map((u) => u.cardId) }) }, D.token);
    let bid2 = null;
    for (let i = 0; i < 20; i++) { const [rr] = await conn.execute('SELECT battle_id FROM battle_rooms WHERE id=?', [rid]); if (rr[0].battle_id) { bid2 = rr[0].battle_id; break; } await sleep(1000); }
    ok('场景2 已开战', !!bid2, bid2);
    // C 是 owner(side0)；让 D(side1) 胜：C 全灭 + over=true
    const [bsx] = await conn.execute('SELECT state FROM battles WHERE id=?', [bid2]);
    const sx = JSON.parse(bsx[0].state);
    sx.player.units.forEach((u) => { u.dead = true; });
    sx.over = true; sx.winner = 1; sx.reason = '我方全部阵亡，敌方获胜';
    await conn.execute('UPDATE battles SET state=?, status=?, winner=? WHERE id=?', [JSON.stringify(sx), 'finished', 1, bid2]);
    // ⚠️ 赢家 D 在扫描器结算前先退出房间 → 应仍按真实胜负给 D 发奖
    const lvD = await api(`/battle/room/${rid}/leave`, { method: 'POST', body: JSON.stringify({ reason: 'leave' }) }, D.token);
    ok('场景2 赢家 D 退出房间返回 200', lvD.code === 200, { code: lvD.code, msg: lvD.msg });
    // 等结算（扫描器可能稍后才跑，但 forfeit 应已结算）
    let fin2 = null;
    for (let i = 0; i < 15; i++) { const [rr] = await conn.execute('SELECT * FROM battle_rooms WHERE id=?', [rid]); if (rr[0].status === 'finished') { fin2 = rr[0]; break; } await sleep(1000); }
    ok('场景2 房间已 finished', !!fin2, fin2 && fin2.status);
    if (fin2) {
      const coinC = (await conn.execute('SELECT coins FROM users WHERE id=?', [C.uid]))[0][0].coins;
      const coinD = (await conn.execute('SELECT coins FROM users WHERE id=?', [D.uid]))[0][0].coins;
      log(`  场景2: C(uid=${C.uid}) coins=${coinC} ; D(uid=${D.uid}) coins=${coinD} ; room.winner=${fin2.winner_user_id}`);
      ok('场景2 赢家 D 拿到底池(=1010)', Number(coinD) === 1010, coinD);
      ok('场景2 输家 C 保持 990', Number(coinC) === 990, coinC);
      ok('场景2 room.winner_user_id = D', Number(fin2.winner_user_id) === D.uid, { w: fin2.winner_user_id, D: D.uid });
    }
    await conn.execute('DELETE FROM feed_logs WHERE user_id IN (?,?)', [C.uid, D.uid]);
    await conn.execute('DELETE FROM battles WHERE player_user_id IN (?,?) OR enemy_user_id IN (?,?)', [C.uid, D.uid, C.uid, D.uid]);
    await conn.execute('DELETE FROM battle_queue WHERE user_id IN (?,?)', [C.uid, D.uid]);
    await conn.execute('DELETE FROM battle_rooms WHERE owner_user_id IN (?,?) OR guest_user_id IN (?,?)', [C.uid, D.uid, C.uid, D.uid]);
    await conn.execute('DELETE FROM user_cards WHERE user_id IN (?,?)', [C.uid, D.uid]);
    await conn.execute('DELETE FROM mnemonic_likes WHERE user_id IN (?,?)', [C.uid, D.uid]);
    await conn.execute('DELETE FROM users WHERE id IN (?,?)', [C.uid, D.uid]);
  }

  // 清理
  await conn.execute('DELETE FROM feed_logs WHERE user_id IN (?,?)', [A.uid, B.uid]);
  await conn.execute('DELETE FROM battles WHERE player_user_id IN (?,?) OR enemy_user_id IN (?,?)', [A.uid, B.uid, A.uid, B.uid]);
  await conn.execute('DELETE FROM battle_queue WHERE user_id IN (?,?)', [A.uid, B.uid]);
  await conn.execute('DELETE FROM battle_rooms WHERE owner_user_id IN (?,?) OR guest_user_id IN (?,?)', [A.uid, B.uid, A.uid, B.uid]);
  await conn.execute('DELETE FROM user_cards WHERE user_id IN (?,?)', [A.uid, B.uid]);
  await conn.execute('DELETE FROM mnemonic_likes WHERE user_id IN (?,?)', [A.uid, B.uid]);
  await conn.execute('DELETE FROM users WHERE id IN (?,?)', [A.uid, B.uid]);
  await conn.end();
  log('已清理');
  log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  out.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 200);
})().catch((e) => { log('FATAL: ' + ((e && e.stack) || e)); out.end(); console.log('FATAL ' + (e && e.message)); process.exit(1); });
