/**
 * 对战「拼写模式」测试：拼中文 / 拼英文
 *  spellMode: 'en-spell'（默认，拼英文，同喂养）| 'zh-spell'（拼中文，任一中文意思即可，同玩耍）
 *  1. 默认不传 → en-spell
 *  2. 显式 en-spell → en-spell，且不推中文模式日志
 *  3. zh-spell → zh-spell + 中文模式日志
 *  4. 乱传 → 回落 en-spell
 *  5. zh-spell 持久化（重新读取仍是 zh-spell）
 *  6. 越权：别人读不到我的局
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BASE = 'http://127.0.0.1:3000/api';
const LOG = path.join(__dirname, '_battle_spellmode_test.log');
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

/** 造 5 张健康可出战卡（feed_deadline 必须在未来 = 健康） */
async function seedBattleCards(conn, uid) {
  const [words] = await conn.query(
    `SELECT id FROM words WHERE pos REGEXP 'noun|verb|adjective|adverb' ORDER BY id LIMIT 14`
  );
  const now = Date.now();
  for (const w of words) {
    await conn.execute(
      `INSERT INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end,
         feed_spell_count, mood_score, play_count, play_correct_count, downgrade_count, is_egg, abandoned)
       VALUES (?, ?, 3, ?, ?, 0, 10, 0, 0, 0, 0, 0)`,
      [uid, w.id, now + 9999999, now + 99999999]
    );
  }
  return words.length;
}

(async () => {
  log('=== 对战拼写模式测试 ===');
  const uname = 'bsp_' + Date.now().toString().slice(-8);
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: uname, password: 'test123456', nickname: '拼写模式测试' }),
  });
  ok('注册成功', reg.code === 200, reg);
  const token = reg.data.token;
  const uid = reg.data.user.id;

  const conn = await mysql.createConnection(cfg);
  const n = await seedBattleCards(conn, uid);
  ok('造卡成功(>=3)', n >= 3, n);

  // 1. 默认 → en-spell
  let r = await api('/battle/ai/start', { method: 'POST', body: JSON.stringify({}) }, token);
  ok('默认开局成功', r.code === 200 && r.data && !!r.data.snap, r.msg);
  ok('默认 spellMode = en-spell', r.data.snap.spellMode === 'en-spell', r.data.snap.spellMode);
  ok('默认无中文模式日志', !(r.data.snap.log || []).some((x) => x.includes('拼中文模式')), r.data.snap.log);

  // 2. 显式 en-spell
  r = await api('/battle/ai/start', { method: 'POST', body: JSON.stringify({ spellMode: 'en-spell' }) }, token);
  ok('显式 en-spell', r.data.snap.spellMode === 'en-spell', r.data.snap.spellMode);
  ok('en-spell 无中文模式日志', !(r.data.snap.log || []).some((x) => x.includes('拼中文模式')), r.data.snap.log);

  // 3. zh-spell
  r = await api('/battle/ai/start', { method: 'POST', body: JSON.stringify({ spellMode: 'zh-spell' }) }, token);
  ok('zh-spell 开局成功', r.code === 200 && !!r.data.snap, r.msg);
  ok('spellMode = zh-spell', r.data.snap.spellMode === 'zh-spell', r.data.snap.spellMode);
  ok('有拼中文模式日志', (r.data.snap.log || []).some((x) => x.includes('拼中文模式')), r.data.snap.log);
  const zhBattleId = r.data.battleId;

  // 4. 乱传 → 回落
  r = await api('/battle/ai/start', { method: 'POST', body: JSON.stringify({ spellMode: 'wtf' }) }, token);
  ok('乱传回落 en-spell', r.data.snap.spellMode === 'en-spell', r.data.snap.spellMode);

  // 5. 持久化
  const got = await api(`/battle/${zhBattleId}`, {}, token);
  ok('重新读取仍为 zh-spell', got.code === 200 && got.data.snap.spellMode === 'zh-spell',
    got.data && got.data.snap && got.data.snap.spellMode);

  // 6. 越权隔离
  const uname2 = 'bsp2_' + Date.now().toString().slice(-8);
  const reg2 = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: uname2, password: 'test123456', nickname: '路人' }),
  });
  const token2 = reg2.data.token;
  const uid2 = reg2.data.user.id;
  const other = await api(`/battle/${zhBattleId}`, {}, token2);
  ok('别人读不到我的局', other.code !== 200 || !other.data, other.code);

  // 清理
  await conn.execute('DELETE FROM feed_logs WHERE user_id IN (?,?)', [uid, uid2]);
  await conn.execute('DELETE FROM user_cards WHERE user_id IN (?,?)', [uid, uid2]);
  await conn.execute('DELETE FROM battles WHERE player_user_id IN (?,?)', [uid, uid2]);
  await conn.execute('DELETE FROM battle_queue WHERE user_id IN (?,?)', [uid, uid2]);
  await conn.execute('DELETE FROM mnemonic_likes WHERE user_id IN (?,?)', [uid, uid2]);
  await conn.execute('DELETE FROM users WHERE id IN (?,?)', [uid, uid2]);
  await conn.end();
  log('已清理 uid=' + uid + ',' + uid2);
  log('');
  log(`=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  out.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 200);
})().catch((e) => { log('FATAL: ' + (e && e.stack || e)); out.end(); console.log('FATAL ' + (e && e.message)); process.exit(1); });
