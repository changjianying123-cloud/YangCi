/**
 * 100/200 档布阵人数验证（需要第二个有 >=10 词的账号）
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const LOG = path.join(__dirname, '_gold_scale_hi.log');
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
  const c = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: 'cjy123com', database: 'word_app' });
  // 给 chang 的 10 张健康卡复制给新账号 big1 / big2（同样的 word_id）
  const mk = async (uname) => {
    const [ex] = await c.query('SELECT id FROM users WHERE username = ?', [uname]);
    if (ex.length) return ex[0].id;
    const crypto = require('crypto');
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = salt + ':' + crypto.scryptSync('cjy123com', salt, 64).toString('hex');
    const [ins] = await c.execute('INSERT INTO users (openid, username, password_hash, nickname, coins, created_at) VALUES (?,?,?,?,?,NOW())', ['dev_' + uname + '_' + Date.now(), uname, hash, uname, 9000]);
    return ins.insertId;
  };
  const now = Date.now();
  for (const uname of ['big1', 'big2']) {
    const uid = await mk(uname);
    await c.execute('UPDATE users SET coins = 9000 WHERE id = ?', [uid]);
    const [cards] = await c.query('SELECT word_id, level FROM user_cards uc JOIN users u ON u.id = uc.user_id WHERE u.username = ? AND uc.feed_deadline > ? LIMIT 12', ['chang', now]);
    log(uname + ' 复制 ' + cards.length + ' 张健康卡');
    for (const cd of cards) {
      await c.execute('INSERT IGNORE INTO user_cards (user_id, word_id, level, feed_deadline, feed_window_end, feed_spell_count, play_count, play_correct_count, mood_score, downgrade_count, is_egg, abandoned) VALUES (?,?,?,?,?,0,0,0,10,0,0,0)', [uid, cd.word_id, cd.level, now + 9999999, now + 99999999]);
    }
  }
  await c.end();

  const t1 = await login('big1', 'cjy123com');
  const t2 = await login('big2', 'cjy123com');
  ok(!!t1 && !!t2, 'big1/big2 登录');

  for (const [bet, need] of [[100, 7], [200, 10]]) {
    const cr = await api('/battle/room/create', { method: 'POST', body: JSON.stringify({ bet }) }, t1);
    if (cr.code !== 200) { ok(false, `create bet=${bet}`, cr.msg); continue; }
    const rid = cr.data.room.id;
    await api('/battle/room/' + rid + '/join', { method: 'POST', body: '{}' }, t2);
    const r1 = await api('/battle/room/' + rid + '/ready', { method: 'POST', body: JSON.stringify({ ready: true }) }, t1);
    const r2 = await api('/battle/room/' + rid + '/ready', { method: 'POST', body: JSON.stringify({ ready: true }) }, t2);
    await sleep(700);
    const v1 = await api('/battle/room/' + rid, {}, t1);
    const v2 = await api('/battle/room/' + rid, {}, t2);
    const rm1 = v1.data && v1.data.room, rm2 = v2.data && v2.data.room;
    const n1 = ((rm1 && rm1.myTroop) || []).length, n2 = ((rm2 && rm2.myTroop) || []).length;
    log(`  bet=${bet} status=${rm1 && rm1.status} troopA=${n1} troopB=${n2} readyA=${r1.code} readyB=${r2.code}`);
    ok(rm1 && rm1.status === 'deploy', `bet=${bet} 进入布阵`, rm1 && rm1.status);
    ok(n1 === need, `bet=${bet} 房主布阵 = ${need} 词`, n1);
    ok(n2 === need, `bet=${bet} 对手布阵 = ${need} 词`, n2);
    await api('/battle/room/' + rid + '/leave', { method: 'POST', body: JSON.stringify({ reason: 'leave' }) }, t1);
    await api('/battle/room/' + rid + '/leave', { method: 'POST', body: JSON.stringify({ reason: 'leave' }) }, t2);
  }

  log('\n========== ' + pass + ' passed, ' + fail + ' failed ==========');
  out.end();
  setTimeout(() => { console.log('pass=' + pass + ' fail=' + fail + ' log=' + LOG); process.exit(fail ? 1 : 0); }, 200);
})();
