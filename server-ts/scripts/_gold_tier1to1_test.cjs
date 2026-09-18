/**
 * 金币场档位改「1币=1词」验证（2026-09-18）
 *  ① /battle/room/bets 返回 10/20/50/100，troop 分别 = 10/20/50/100，无 200
 *  ② 词不够 → affordable=false；建房被拒（文案含需要数）
 *  ③ 10 档：双方布阵各 10 词；20 档：各 20 词（用自造账号）
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const LOG = path.join(__dirname, '_gold_tier1to1.log');
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

(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: 'cjy123com', database: 'word_app' });
  const now = Date.now();
  // 造两个 25 词的账号（这样 10/20 档都能开，50/100 档会被拒 → 顺便验证锁档）
  const mk = async (uname) => {
    const [ex] = await conn.query('SELECT id FROM users WHERE username = ?', [uname]);
    if (ex.length) { await conn.execute('UPDATE users SET coins = 9000 WHERE id = ?', [ex[0].id]); return ex[0].id; }
    const crypto = require('crypto');
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = salt + ':' + crypto.scryptSync('cjy123com', salt, 64).toString('hex');
    const [ins] = await conn.execute('INSERT INTO users (openid, username, password_hash, nickname, coins, created_at) VALUES (?,?,?,?,?,NOW())', ['dev_' + uname + '_' + Date.now(), uname, hash, uname, 9000]);
    return ins.insertId;
  };
  const [words] = await conn.query('SELECT id FROM words WHERE pos IS NOT NULL LIMIT 30');
  for (const uname of ['tier1', 'tier2']) {
    const uid = await mk(uname);
    for (const w of words) {
      await conn.execute('INSERT IGNORE INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end, feed_spell_count, play_count, play_correct_count, mood_score, downgrade_count, is_egg, abandoned) VALUES (?,?,1,?,?,0,0,0,10,0,0,0)', [uid, w.id, now + 9999999, now + 99999999]);
    }
  }
  const [[cnt]] = await conn.query("SELECT COUNT(1) n FROM user_cards uc JOIN users u ON u.id=uc.user_id WHERE u.username='tier1' AND uc.feed_deadline > ?", [now]);
  log('tier1 健康卡 = ' + cnt.n);
  await conn.end();

  const t1 = await login('tier1', 'cjy123com');
  const t2 = await login('tier2', 'cjy123com');
  ok(!!t1 && !!t2, 'tier1/tier2 登录');

  log('\n=== ① /battle/room/bets 档位表 ===');
  const bets = await api('/battle/room/bets', {}, t1);
  log('  options=' + JSON.stringify(bets.data && bets.data.options));
  log('  optionsDetail=' + JSON.stringify(bets.data && bets.data.optionsDetail));
  const opts = (bets.data && bets.data.options) || [];
  ok(JSON.stringify(opts) === JSON.stringify([10, 20, 50, 100]), '档位 = 10/20/50/100（无 200）', opts);
  const det = (bets.data && bets.data.optionsDetail) || [];
  for (const [bet, want] of [[10, 10], [20, 20], [50, 50], [100, 100]]) {
    const d = det.find((x) => x.bet === bet);
    ok(d && d.troop === want, `bet=${bet} → troop=${want}`, d);
  }
  ok(!det.some((x) => x.bet === 200), '没有 200 档');

  log('\n=== ② 锁档：25 词 → 10/20 可开，50/100 不可 ===');
  const d10 = det.find((x) => x.bet === 10), d20 = det.find((x) => x.bet === 20);
  const d50 = det.find((x) => x.bet === 50), d100 = det.find((x) => x.bet === 100);
  ok(d10 && d10.affordable === true, '10 档可开');
  ok(d20 && d20.affordable === true, '20 档可开');
  ok(d50 && d50.affordable === false, '50 档置灰（词不够）', d50);
  ok(d100 && d100.affordable === false, '100 档置灰（词不够）', d100);
  const over = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet: 50 }) }, t1);
  log('  create bet=50 -> code=' + over.code + ' msg=' + over.msg);
  ok(over.code !== 200, '建房 bet=50 被拒');
  ok(/不够|需要/.test(String(over.msg)), '拒绝文案含「不够/需要」', over.msg);

  log('\n=== ③ 布阵人数 = 档位 ===');
  for (const [bet, need] of [[10, 10], [20, 20]]) {
    const c = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet }) }, t1);
    if (c.code !== 200) { ok(false, `create bet=${bet}`, c.msg); continue; }
    const rid = c.data.room.id;
    await api(`/battle/room/${rid}/join`, { method: 'POST', body: '{}' }, t2);
    await api(`/battle/room/${rid}/ready`, { method: 'POST', body: JSON.stringify({ ready: true }) }, t1);
    await api(`/battle/room/${rid}/ready`, { method: 'POST', body: JSON.stringify({ ready: true }) }, t2);
    await sleep(800);
    const v1 = await api(`/battle/room/${rid}`, {}, t1);
    const v2 = await api(`/battle/room/${rid}`, {}, t2);
    const n1 = ((v1.data && v1.data.room && v1.data.room.myTroop) || []).length;
    const n2 = ((v2.data && v2.data.room && v2.data.room.myTroop) || []).length;
    log(`  bet=${bet} status=${v1.data && v1.data.room && v1.data.room.status} troopA=${n1} troopB=${n2}`);
    ok(v1.data && v1.data.room && v1.data.room.status === 'deploy', `bet=${bet} 进入布阵`);
    ok(n1 === need, `bet=${bet} 房主布阵 = ${need} 词`, n1);
    ok(n2 === need, `bet=${bet} 对手布阵 = ${need} 词`, n2);
    await api(`/battle/room/${rid}/leave`, { method: 'POST', body: JSON.stringify({ reason: 'leave' }) }, t1);
    await api(`/battle/room/${rid}/leave`, { method: 'POST', body: JSON.stringify({ reason: 'leave' }) }, t2);
  }

  log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
  out.end();
  setTimeout(() => { console.log('pass=' + pass + ' fail=' + fail + ' log=' + LOG); process.exit(fail ? 1 : 0); }, 300);
})();
