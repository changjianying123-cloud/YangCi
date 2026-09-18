/**
 * 「不足 10 个健康单词不能打」测试（2026-09-18）
 *  ① AI 场：健康词 < 10 → /battle/ai/start 拒绝
 *  ② 金币场：健康词 < 档位所需 → /room/create、/gold/join 拒绝
 *  ③ 健康词 >= 10 的用户应能正常开 AI 场
 *
 * 用法：cd server-ts && node scripts/_min_words_test.cjs
 */
const fs = require('fs');
const path = require('path');
const LOG = path.join(__dirname, '_min_words_test.log');
if (fs.existsSync(LOG)) fs.unlinkSync(LOG);
const out = fs.createWriteStream(LOG, { encoding: 'utf8' });
const log = (...a) => out.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; log('  OK  ' + label); } else { fail++; log('  FAIL ' + label); } }

const BASE = 'http://localhost:3000/api';
async function req(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await res.json(); } catch { j = null; }
  return { status: res.status, body: j };
}
async function login(u, p) {
  const r = await req('POST', '/auth/login', { username: u, password: p });
  return (r.body && r.body.data && (r.body.data.token || (r.body.data.user && r.body.data.user.token))) || null;
}
const msgOf = (r) => String((r.body && (r.body.msg || r.body.message)) || '');

(async () => {
  // ===== sprite：只有 5 个健康词 =====
  log('=== sprite（5 个健康词，不足 10）===');
  const ts = await login('sprite', 'cjy123com');
  ok(!!ts, 'sprite 登录');
  if (ts) {
    const b = await req('GET', '/battle/room/bets', null, ts);
    const myWords = (b.body && b.body.data && b.body.data.myWords) || 0;
    log('  sprite 健康词 = ' + myWords);
    ok(myWords < 10, 'sprite 确实不足 10（' + myWords + '）');

    // ① AI 场应被拒
    const ai = await req('POST', '/battle/ai/start', { spellMode: 'zh-spell' }, ts);
    log('  ai/start -> status=' + ai.status + ' code=' + (ai.body && ai.body.code) + ' msg=' + msgOf(ai));
    ok(ai.status === 400 || (ai.body && ai.body.code !== 200), 'AI 场被拒绝（不足 10）');
    ok(/10|健康单词|不够/.test(msgOf(ai)), 'AI 场错误文案提到缺单词');

    // ② 金币场高档应被拒
    const c200 = await req('POST', '/battle/room/create', { bet: 200 }, ts);
    log('  room/create(200) -> ' + msgOf(c200));
    ok(c200.status === 400 || (c200.body && c200.body.code !== 200), '押 200 被拒绝');
    ok(/不够|只有/.test(msgOf(c200)), '文案提到单词不够');

    // ③ 金币场最低档（需 3 词，sprite 有 5）应能开
    const c10 = await req('POST', '/battle/room/create', { bet: 10 }, ts);
    log('  room/create(10) -> status=' + c10.status + ' code=' + (c10.body && c10.body.code));
    ok(c10.status === 200 && c10.body && c10.body.code === 200, '押 10（需3词）能开房');
    if (c10.status === 200) {
      const rid = c10.body.data && c10.body.data.room && c10.body.data.room.id;
      await req('POST', `/battle/room/${rid}/leave`, { reason: 'leave' }, ts);
    }

    // ④ 金币场 100 档（需 7 词）应被拒
    const c100 = await req('POST', '/battle/room/create', { bet: 100 }, ts);
    log('  room/create(100) -> ' + msgOf(c100));
    ok(c100.status === 400 || (c100.body && c100.body.code !== 200), '押 100（需7词）被拒绝');
  }

  // ===== chang：有 10 个健康词 =====
  log('=== chang（10 个健康词，刚好够）===');
  const tc = await login('chang', 'cjy123com');
  ok(!!tc, 'chang 登录');
  if (tc) {
    const b = await req('GET', '/battle/room/bets', null, tc);
    const myWords = (b.body && b.body.data && b.body.data.myWords) || 0;
    log('  chang 健康词 = ' + myWords);
    if (myWords >= 10) {
      const ai = await req('POST', '/battle/ai/start', { spellMode: 'zh-spell' }, tc);
      log('  ai/start -> status=' + ai.status + ' code=' + (ai.body && ai.body.code));
      ok(ai.status === 200 && ai.body && ai.body.code === 200, 'chang 能开 AI 场（10 词）');
      const snap = ai.body && ai.body.data && (ai.body.data.snap || ai.body.data);
      if (snap && snap.player) {
        log('  我方 ' + snap.player.units.length + ' 词 / 敌方 ' + (snap.enemy ? snap.enemy.units.length : '?') + ' 词');
        ok(snap.player.units.length === 10, '我方 10 词');
        ok(snap.enemy && snap.enemy.units.length === 10, '敌方 10 词');
      }
      // 押 200（需 10 词）应能开
      const c200 = await req('POST', '/battle/room/create', { bet: 200 }, tc);
      log('  room/create(200) -> status=' + c200.status + ' code=' + (c200.body && c200.body.code));
      ok(c200.status === 200 && c200.body && c200.body.code === 200, 'chang 押 200（需10词）能开房');
      if (c200.status === 200) {
        const rid = c200.body.data && c200.body.data.room && c200.body.data.room.id;
        await req('POST', `/battle/room/${rid}/leave`, { reason: 'leave' }, tc);
      }
    } else {
      log('  （chang 健康词不足 10，跳过正例）');
    }
  }

  log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
  out.end();
  setTimeout(() => { console.log('pass=' + pass + ' fail=' + fail + ' log=' + LOG); process.exit(fail ? 1 : 0); }, 200);
})();
