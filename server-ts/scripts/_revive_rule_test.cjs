/**
 * 复活机制测试：这局里「从没出过手就阵亡」的单词才能复活
 *   canRevive := dead && !usedSkill && !revived
 *   即：本局一次都没出过手就死了（上来就死）→ 可复活；出过手的 → 不可复活。
 * 覆盖：
 *   1. 开局 + 布阵
 *   2. 阵亡 && !usedSkill && !revived → 复活按钮应出现（revivableIds 含它）
 *   3. 阵亡 && usedSkill=true（出过手）→ 不可复活（调 revive 被拒）
 *   4. 阵亡 && revived=true（本局复活过）→ 不可复活
 *   5. 没出过手的词复活 + 拼对 → 成功复活（dead=false）
 *   6. 没出过手的词复活 + 拼错 → 复活失败且标记 revived（不能再试）
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BASE = 'http://127.0.0.1:3000/api';
const LOG = path.join(__dirname, '_revive_rule_test.log');
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

const cfg = {
  host: '127.0.0.1', user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'cjy123com',
  database: process.env.DB_NAME || 'word_app',
};

/** 深拷贝快照，patch 指定 unit；并强制「我方回合、未超时、未结束」 */
function patchUnit(snap, sideKey, cardId, patch) {
  const s = JSON.parse(JSON.stringify(snap));
  const u = s[sideKey].units.find((x) => x.cardId === cardId);
  Object.assign(u, patch);
  s.currentSide = 0;
  s.activeUntil = Date.now() + 60000;
  s.over = false;
  return s;
}

async function startAndDeploy(token) {
  const r = await api('/battle/ai/start', { method: 'POST', body: JSON.stringify({}) }, token);
  const battleId = r.data.battleId;
  await api(`/battle/${battleId}/deploy`, {
    method: 'POST',
    body: JSON.stringify({ order: r.data.snap.player.units.map((u) => u.cardId) }),
  }, token);
  const cur = await api(`/battle/${battleId}`, {}, token);
  const live = (cur.data && cur.data.snap) || (cur.data && cur.data) || r.data.snap;
  return { battleId, snap: live };
}

(async () => {
  log('=== 复活机制测试（本局没出过手就阵亡 → 可复活）===');
  const uname = 'rvv_' + Date.now().toString().slice(-8);
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: uname, password: 'test123456', nickname: '复活测试' }),
  });
  ok('注册成功', reg.code === 200, reg.msg);
  const token = reg.data.token;
  const uid = reg.data.user.id;

  const conn = await mysql.createConnection(cfg);
  const now = Date.now();
  const [words] = await conn.query(
    `SELECT id, pos FROM words WHERE pos IS NOT NULL AND pos <> '' ORDER BY id LIMIT 40`
  );
  const picked = [];
  const seenPos = new Set();
  // ⭐ 2026-09-18：AI 场现在要 10 个健康词，造 12 张（保证够）
  for (const w of words) {
    if (!seenPos.has(w.pos) || picked.length < 12) { picked.push(w); seenPos.add(w.pos); }
    if (picked.length >= 12) break;
  }
  for (const w of picked) {
    await conn.execute(
      `INSERT INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end,
         feed_spell_count, play_count, play_correct_count, mood_score, downgrade_count, is_egg, abandoned)
       VALUES (?, ?, 3, ?, ?, 0, 0, 0, 10, 0, 0, 0)`,
      [uid, w.id, now + 9999999, now + 99999999]
    );
  }
  ok('造卡成功(>=10)', picked.length >= 10, picked.length);

  // --- 场景 A：阵亡 && 没出过手 → 可复活 ---
  {
    const { battleId, snap } = await startAndDeploy(token);
    const u = snap.player.units[0];
    await conn.execute('UPDATE battles SET state = ? WHERE id = ?', [
      JSON.stringify(patchUnit(snap, 'player', u.cardId, { dead: true, usedSkill: false, revived: false })),
      battleId,
    ]);
    const rv = await api(`/battle/${battleId}/act`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'revive', unit_card_id: u.cardId, spell_correct: true }),
    }, token);
    ok('A. 没出过手就阵亡 → 复活成功', rv.code === 200, { code: rv.code, msg: rv.msg });
    const after = rv.data && rv.data.snap ? rv.data.snap.player.units.find((x) => x.cardId === u.cardId) : null;
    ok('A. 复活后 dead=false', !!after && after.dead === false, after);
    ok('A. 有成功复活日志', !!(rv.data && (rv.data.snap.log || []).some((l) => l.includes('成功复活'))),
      rv.data && rv.data.snap.log);
  }

  // --- 场景 B：阵亡 && 出过手(usedSkill=true) → 不可复活 ---
  {
    const { battleId, snap } = await startAndDeploy(token);
    const u = snap.player.units[0];
    await conn.execute('UPDATE battles SET state = ? WHERE id = ?', [
      JSON.stringify(patchUnit(snap, 'player', u.cardId, { dead: true, usedSkill: true, revived: false })),
      battleId,
    ]);
    const rv = await api(`/battle/${battleId}/act`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'revive', unit_card_id: u.cardId, spell_correct: true }),
    }, token);
    ok('B. 出过手的词复活被拒', rv.code !== 200, { code: rv.code, msg: rv.msg });
    ok('B. 被拒原因是不可复活', /不可复活/.test(String(rv.msg || '')), rv.msg);
  }

  // --- 场景 C：阵亡 && 本局已复活过(revived=true) → 不可复活 ---
  {
    const { battleId, snap } = await startAndDeploy(token);
    const u = snap.player.units[0];
    await conn.execute('UPDATE battles SET state = ? WHERE id = ?', [
      JSON.stringify(patchUnit(snap, 'player', u.cardId, { dead: true, usedSkill: false, revived: true })),
      battleId,
    ]);
    const rv = await api(`/battle/${battleId}/act`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'revive', unit_card_id: u.cardId, spell_correct: true }),
    }, token);
    ok('C. 已复活过的词再复活被拒', rv.code !== 200, { code: rv.code, msg: rv.msg });
  }

  // --- 场景 D：没出过手就阵亡 + 拼错 → 复活失败且不可再试 ---
  {
    const { battleId, snap } = await startAndDeploy(token);
    const u = snap.player.units[0];
    await conn.execute('UPDATE battles SET state = ? WHERE id = ?', [
      JSON.stringify(patchUnit(snap, 'player', u.cardId, { dead: true, usedSkill: false, revived: false })),
      battleId,
    ]);
    const rv = await api(`/battle/${battleId}/act`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'revive', unit_card_id: u.cardId, spell_correct: false }),
    }, token);
    ok('D. 拼错也算一次复活结算(200 + 失败日志)', rv.code === 200, { code: rv.code, msg: rv.msg });
    ok('D. 失败日志含「失败」', !!(rv.data && (rv.data.snap.log || []).some((l) => l.includes('复活') && l.includes('失败'))),
      rv.data && rv.data.snap.log);
    const after = rv.data && rv.data.snap ? rv.data.snap.player.units.find((x) => x.cardId === u.cardId) : null;
    ok('D. 失败后 revived=true（不可再试）', !!after && after.revived === true, after);
  }

  await conn.execute('DELETE FROM feed_logs WHERE user_id = ?', [uid]);
  await conn.execute('DELETE FROM battles WHERE player_user_id = ?', [uid]);
  await conn.execute('DELETE FROM battle_queue WHERE user_id = ?', [uid]);
  await conn.execute('DELETE FROM user_cards WHERE user_id = ?', [uid]);
  await conn.execute('DELETE FROM mnemonic_likes WHERE user_id = ?', [uid]);
  await conn.execute('DELETE FROM users WHERE id = ?', [uid]);
  await conn.end();
  log('已清理 uid=' + uid);
  log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  out.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 200);
})().catch((e) => { log('FATAL: ' + ((e && e.stack) || e)); out.end(); console.log('FATAL ' + (e && e.message)); process.exit(1); });
