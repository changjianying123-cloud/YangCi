/**
 * 方案 C 测试：词性一局内固定不变
 *  C1: 一方攻击手(动词)全部阵亡 → 该方判负（不再自动推举兼职攻击手）
 *  C3: 词池里一个动词都没有 → 不允许开战（AI 场 400；金币场开战失败退押金）
 *  词性固定: 多词性词 'n.,adj.' 只取第一个(noun)，任何阶段都不变
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const LOG = path.join(__dirname, '_role_lock_test.log');
const out = fs.createWriteStream(LOG, { flags: 'w' });
let pass = 0, fail = 0;
const log = (s) => out.write(s + '\n');
function ok(name, cond, extra) {
  if (cond) { pass++; log(`  ✓ ${name}`); }
  else { fail++; log(`  ✗ ${name} | got: ${JSON.stringify(extra)}`); }
}
const BASE = 'http://127.0.0.1:3000/api';
async function api(p, opts = {}, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { ...opts, headers });
  const t = await res.text();
  try { return JSON.parse(t); } catch (_) { return { raw: t, status: res.status }; }
}
const cfg = { host: '127.0.0.1', user: 'root', password: 'cjy123com', database: 'word_app' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 找一个词性为纯动词的词，以及多词性词
async function pickWords(conn) {
  const [v] = await conn.query(`SELECT id, word, pos FROM words WHERE pos = 'verb' LIMIT 5`);
  const [multi] = await conn.query(`SELECT id, word, pos FROM words WHERE pos = 'noun,adjective' LIMIT 5`);
  const [n] = await conn.query(`SELECT id, word, pos FROM words WHERE pos = 'noun' LIMIT 5`);
  // ⭐ 2026-09-18：AI 场/金币场现在要求 10 个健康词。测验里存的数组不够 10 个，
  //    这里再取一批「纯名词」用来凑数（凑数只需不引入动词即可）。
  const [pad] = await conn.query(`SELECT id, word, pos FROM words WHERE pos = 'noun' LIMIT 30`);
  const [padAdj] = await conn.query(`SELECT id, word, pos FROM words WHERE pos = 'adjective' LIMIT 30`);
  return { verbs: v, multi, nouns: n, pad: pad.concat(padAdj) };
}

(async () => {
  log('=== 方案 C：词性固定 测试 ===');
  const conn = await mysql.createConnection(cfg);
  const W = await pickWords(conn);
  log('  动词样例: ' + JSON.stringify(W.verbs.map(w => w.word + '/' + w.pos)));
  log('  多词性样例: ' + JSON.stringify(W.multi.map(w => w.word + '/' + w.pos)));
  ok('库里有纯动词词', W.verbs.length > 0, W.verbs.length);
  ok('库里有名词词', W.nouns.length > 0, W.nouns.length);

  async function mkUser(tag) {
    const uname = tag + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100);
    const reg = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username: uname, password: 'test123456', nickname: tag }) });
    return { uid: reg.data.user.id, token: reg.data.token };
  }
  const now = Date.now();
  const MIN_WORDS = 10; // 🤖 AI 场/金币场现在的最低健康词数
  async function giveCards(uid, wordIds) {
    const seen = new Set();
    for (const wid of wordIds) {
      if (seen.has(wid)) continue; // 去重：同一 word_id 会撞唯一键
      seen.add(wid);
      await conn.execute(`INSERT INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end, feed_spell_count, play_count, play_correct_count, mood_score, downgrade_count, is_egg, abandoned) VALUES (?,?,3,?,?,0,0,0,10,0,0,0)`, [uid, wid, now + 9999999, now + 99999999]);
    }
    // ⭐ 2026-09-18：AI 场现在要 10 个健康词 -> 不足时用 pad（纯名词/形容词，不含动词）补足，
    //    不影响「有无动词」的测验语义。
    if (seen.size < MIN_WORDS) {
      for (const w of W.pad) {
        if (seen.size >= MIN_WORDS) break;
        if (seen.has(w.id)) continue;
        seen.add(w.id);
        await conn.execute(`INSERT INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end, feed_spell_count, play_count, play_correct_count, mood_score, downgrade_count, is_egg, abandoned) VALUES (?,?,3,?,?,0,0,0,10,0,0,0)`, [uid, w.id, now + 9999999, now + 99999999]);
      }
    }
  }

  // ---------- C3-a: AI 场，只有名词(无动词) → 400 不许开战 ----------
  {
    const U = await mkUser('nv');
    await giveCards(U.uid, W.nouns.slice(0, 5).map(w => w.id));
    const r = await api('/battle/ai/start', { method: 'POST', body: JSON.stringify({ spellMode: 'en-spell' }) }, U.token);
    log('  C3-AI 返回: code=' + r.code + ' msg=' + r.msg);
    ok('C3 AI场: 无动词不许开战(code!=200)', r.code !== 200, r.code);
    ok('C3 AI场: 提示语提到动词', /动词/.test(String(r.msg)), r.msg);
    await conn.execute('DELETE FROM battles WHERE player_user_id=?', [U.uid]);
    await conn.execute('DELETE FROM user_cards WHERE user_id=?', [U.uid]);
    await conn.execute('DELETE FROM mnemonic_likes WHERE user_id=?', [U.uid]);
    await conn.execute('DELETE FROM users WHERE id=?', [U.uid]);
  }

  // ---------- C3-b: AI 场，带动词 → 能开战；且所有 unit.role 在起手时就固定 ----------
  let uidV = null, tokenV = null, battleId = null, rolesAtStart = null;
  {
    const U = await mkUser('wv');
    uidV = U.uid; tokenV = U.token;
    await giveCards(U.uid, [...W.verbs.slice(0, 3).map(w => w.id), ...W.nouns.slice(0, 3).map(w => w.id), ...W.multi.slice(0, 2).map(w => w.id)]);
    const r = await api('/battle/ai/start', { method: 'POST', body: JSON.stringify({ spellMode: 'en-spell' }) }, U.token);
    ok('C3 带动词可开战 (code=200)', r.code === 200, { code: r.code, msg: r.msg });
    if (r.code === 200) {
      battleId = r.data.battleId;
      rolesAtStart = r.data.snap.player.units.map(u => ({ cardId: u.cardId, word: u.word, role: u.role }));
      log('  起手词性: ' + JSON.stringify(rolesAtStart));
      ok('起手有动词攻击手', rolesAtStart.some(u => u.role === 'verb'), rolesAtStart);
    }
  }

  // ---------- C1: 把场上动词全打死 → 回合推进后应判我方负 ----------
  if (battleId) {
    const [bs] = await conn.execute('SELECT state FROM battles WHERE id=?', [battleId]);
    const s = JSON.parse(bs[0].state);
    // 记下原本的动词，全部打死
    let killed = 0;
    s.player.units.forEach((u) => { if (u.role === 'verb') { u.dead = true; killed++; } });
    ok('场上确实有动词可打死', killed > 0, killed);
    // 让对手行动一次以触发回合末判定：直接把 activeUntil 设为过去，currentSide=1（AI 回合）
    s.currentSide = 1;
    s.activeUntil = Date.now() - 5000;
    s.deployed = true; // ⭐ pollBattle 在 !deployed 时直接返回，不走回合推进
    // 清掉可能存在的被改名角色：断言除动词外没人被改成 verb
    await conn.execute('UPDATE battles SET state=?, turn_deadline=? WHERE id=?', [JSON.stringify(s), s.activeUntil, battleId]);
    // 轮询触发 AI 回合 + scanAutoEnd
    let fin = null;
    for (let i = 0; i < 12; i++) {
      const p = await api(`/battle/${battleId}`, {}, tokenV);
      const ps = (p.data && p.data.snap) || p.data;
      if (i === 0) log('  首次轮询: code=' + p.code + ' over=' + (ps && ps.over) + ' currentSide=' + (ps && ps.currentSide) + ' deployed=' + (ps && ps.deployed) + ' msg=' + p.msg);
      if (ps && ps.over) { fin = ps; break; }
      await sleep(800);
    }
    ok('C1: 动词全灭后对局结束', !!fin, fin && fin.over);
    if (fin) {
      log('  C1 结束: winner=' + fin.winner + ' reason=' + fin.reason);
      ok('C1: winner=1 (我方负)', fin.winner === 1, fin.winner);
      ok('C1: 原因是攻击手阵亡', /攻击手|动词/.test(String(fin.reason)), fin.reason);
      // 关键：确认没有任何非动词单位被改写成 verb
      const finalRoles = fin.player.units.map(u => ({ word: u.word, role: u.role }));
      log('  终局词性: ' + JSON.stringify(finalRoles));
      const startMap = new Map(rolesAtStart.map(u => [u.cardId, u.role]));
      let changed = 0;
      for (const u of fin.player.units) { if (startMap.get(u.cardId) !== u.role) changed++; }
      ok('C1: 全程没有任何词性被改写', changed === 0, { changed, finalRoles });
    }
  }

  // ---------- C3-c: 金币场，一方无动词 → 开战失败并退还押金 ----------
  {
    const A = await mkUser('ga'); // 有动词
    const B = await mkUser('gb'); // 只有名词
    await giveCards(A.uid, W.verbs.slice(0, 4).map(w => w.id));
    await giveCards(B.uid, W.nouns.slice(0, 4).map(w => w.id));
    await conn.execute('UPDATE users SET coins=1000 WHERE id IN (?,?)', [A.uid, B.uid]);
    const c = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet: 10 }) }, A.token);
    const rid = c.data && (c.data.roomId || (c.data.room && c.data.room.id)) || (c.data && c.data.id);
    ok('C3 金币场 建房成功', !!rid, c.data);
    if (rid) {
      await api(`/battle/room/${rid}/join`, { method: 'POST', body: JSON.stringify({}) }, B.token);
      await api(`/battle/room/${rid}/ready`, { method: 'POST', body: JSON.stringify({}) }, A.token);
      const r2 = await api(`/battle/room/${rid}/ready`, { method: 'POST', body: JSON.stringify({}) }, B.token);
      ok('C3 金币场 双方准备(扣押押注)', r2.code === 200, { code: r2.code, msg: r2.msg });
      const vA = (await api(`/battle/room/${rid}`, {}, A.token)).data.room;
      // B 只有名词，myTroop 里应该没有 verb
      const vB = (await api(`/battle/room/${rid}`, {}, B.token)).data.room;
      log('  B 布阵阵容: ' + JSON.stringify((vB.myTroop || []).map(u => u.word + ':' + u.role)));
      ok('C3: B 的阵容里没有动词', !(vB.myTroop || []).some(u => u.role === 'verb'), (vB.myTroop || []).map(u => u.role));
      await api(`/battle/room/${rid}/deploy`, { method: 'POST', body: JSON.stringify({ order: (vA.myTroop || []).map(u => u.cardId) }) }, A.token);
      const dB = await api(`/battle/room/${rid}/deploy`, { method: 'POST', body: JSON.stringify({ order: (vB.myTroop || []).map(u => u.cardId) }) }, B.token);
      ok('C3: 无动词方布阵 → 开战被拒(code!=200)', dB.code !== 200, { code: dB.code, msg: dB.msg });
      ok('C3: 提示语提到动词', /动词/.test(String(dB.msg)), dB.msg);
      // 房间应被取消 + 押注退回
      await sleep(600);
      const [rr] = await conn.execute('SELECT status, winner_user_id FROM battle_rooms WHERE id=?', [rid]);
      const coinA = (await conn.execute('SELECT coins FROM users WHERE id=?', [A.uid]))[0][0].coins;
      const coinB = (await conn.execute('SELECT coins FROM users WHERE id=?', [B.uid]))[0][0].coins;
      log('  房间 status=' + rr[0].status + ' ; A.coins=' + coinA + ' B.coins=' + coinB);
      ok('C3: 房间已取消', rr[0].status === 'cancelled', rr[0].status);
      ok('C3: A 押注已退还(1000)', Number(coinA) === 1000, coinA);
      ok('C3: B 押注已退还(1000)', Number(coinB) === 1000, coinB);
    }
    // 清理
    for (const u of [A, B]) {
      await conn.execute('DELETE FROM feed_logs WHERE user_id=?', [u.uid]);
      await conn.execute('DELETE FROM battles WHERE player_user_id=? OR enemy_user_id=?', [u.uid, u.uid]);
      await conn.execute('DELETE FROM battle_queue WHERE user_id=?', [u.uid]);
      await conn.execute('DELETE FROM battle_rooms WHERE owner_user_id=? OR guest_user_id=?', [u.uid, u.uid]);
      await conn.execute('DELETE FROM user_cards WHERE user_id=?', [u.uid]);
      await conn.execute('DELETE FROM mnemonic_likes WHERE user_id=?', [u.uid]);
      await conn.execute('DELETE FROM users WHERE id=?', [u.uid]);
    }
  }

  // 清理
  if (uidV) {
    await conn.execute('DELETE FROM feed_logs WHERE user_id=?', [uidV]);
    await conn.execute('DELETE FROM battles WHERE player_user_id=? OR enemy_user_id=?', [uidV, uidV]);
    await conn.execute('DELETE FROM battle_queue WHERE user_id=?', [uidV]);
    await conn.execute('DELETE FROM battle_rooms WHERE owner_user_id=? OR guest_user_id=?', [uidV, uidV]);
    await conn.execute('DELETE FROM user_cards WHERE user_id=?', [uidV]);
    await conn.execute('DELETE FROM mnemonic_likes WHERE user_id=?', [uidV]);
    await conn.execute('DELETE FROM users WHERE id=?', [uidV]);
  }
  await conn.end();
  log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  out.end();
  console.log('PASS=' + pass + ' FAIL=' + fail);
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 200);
})().catch((e) => { log('FATAL: ' + ((e && e.stack) || e)); out.end(); console.log('FATAL ' + (e && e.message)); process.exit(1); });
