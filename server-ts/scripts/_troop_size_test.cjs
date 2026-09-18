/**
 * 阵容人数 + 词性放宽 测试（2026-09-18）
 *  ① AI 场：每方 10 个单词（词池不足则有多少用多少）
 *  ② 金币场：单词数按押注档位 10→3 / 30→4 / 50→5 / 100→7 / 200→10
 *  ③ 单词不够 -> 拒绝（createRoom / joinRoom / joinQueue / startRoomBattle）
 *  ④ 词性放宽：pos 含 verb 就优先当动词（'noun,verb' -> verb）
 *
 * 用法：cd server-ts && node scripts/_troop_size_test.cjs
 */
const fs = require('fs');
const path = require('path');

// ===== 纯逻辑部分：编译 battleLogic + battleService 的 formSide =====
// formSide 在 battleService 里未导出，这里直接 require 编译产物里的构建函数用公测接口
const LOG = path.join(__dirname, '_troop_size_test.log');
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
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  return { status: res.status, body: j };
}
async function login(username) {
  const r = await req('POST', '/auth/login', { username, password: 'cjy123com' });
  const t = (r.body && r.body.data && (r.body.data.token || (r.body.data.user && r.body.data.user.token))) || null;
  return t;
}

(async () => {
  // ===== 1) battleLogic 常量 =====
  log('=== 1) 常量 & 档位表 ===');
  const os = require('os');
  const { execSync } = require('child_process');
  const root = path.join(__dirname, '..');
  const outDir = path.join(root, '.scratch', 'troop');
  fs.rmSync(outDir, { recursive: true, force: true });
  execSync(`npx tsc src/utils/battleLogic.ts src/types/index.ts --outDir "${outDir}" --module commonjs --target es2019 --skipLibCheck --esModuleInterop`, { cwd: root, stdio: 'inherit' });
  const BL = require(path.join(outDir, 'utils', 'battleLogic.js'));
  ok(BL.AI_TROOP_SIZE === 10, 'AI_TROOP_SIZE = 10');
  ok(BL.goldTroopSize(10) === 10, 'goldTroopSize(10) = 10');
  ok(BL.goldTroopSize(20) === 20, 'goldTroopSize(20) = 20');
  ok(BL.goldTroopSize(50) === 50, 'goldTroopSize(50) = 50');
  ok(BL.goldTroopSize(100) === 100, 'goldTroopSize(100) = 100');
  ok(BL.goldTroopSize(7) === 7, '未知档位按 bet 取 (7)');
  ok(BL.MAX_TROOP_SIZE === 100, 'MAX_TROOP_SIZE = 100');

  // ===== 2) 词性放宽逻辑（primaryRole 非导出，用行为验证：AI 场起的队伍里 noun,verb 应成动词）=====
  // 直接验证：查一个 pos='noun,verb' 的卡，看它在本局 role
  log('=== 2) 词性放宽：pos 含 verb -> 本局当动词 ===');
  const token = await login('chang');
  ok(!!token, 'chang 登录成功');
  if (token) {
    const r = await req('POST', '/battle/ai/start', { spellMode: 'zh-spell' }, token);
    ok(r.status === 200 && r.body && r.body.code === 200, 'AI 场开战成功（code 200）');
    const snap = r.body && r.body.data && (r.body.data.snap || r.body.data);
    if (snap && snap.player) {
      const units = snap.player.units || [];
      log('  我的出战 ' + units.length + ' 个: ' + units.map((u) => u.word + '/' + u.role).join(', '));
      ok(units.length === BL.AI_TROOP_SIZE, '出战数 = 10');
      ok(units.some((u) => u.role === 'verb'), '队里至少 1 个动词（攻击手）');
      // 敌方（AI）也是 10
      const eu = (snap.enemy && snap.enemy.units) || [];
      log('  AI 出战 ' + eu.length + ' 个');
      ok(eu.length <= BL.AI_TROOP_SIZE, 'AI 出战数 <= 10');
    }
  }

  // ===== 3) 金币场档位接口带 troop/affordable =====
  log('=== 3) /battle/room/bets 返回档位详情 ===');
  if (token) {
    const r = await req('GET', '/battle/room/bets', null, token);
    ok(r.status === 200 && r.body && r.body.code === 200, 'room/bets 200');
    const d = (r.body && r.body.data) || {};
    ok(Array.isArray(d.options) && d.options.length === 4, 'options 4 档');
    ok(Array.isArray(d.optionsDetail) && d.optionsDetail.length === 4, 'optionsDetail 4 档');
    ok(typeof d.myWords === 'number', 'myWords 是数字 (' + d.myWords + ')');
    if (Array.isArray(d.optionsDetail)) {
      d.optionsDetail.forEach((o) => log('  押 ' + o.bet + ' -> ' + o.troop + ' 词, 够=' + o.affordable));
      ok(d.optionsDetail.every((o) => typeof o.troop === 'number' && typeof o.affordable === 'boolean'), '每档都有 troop+affordable');
      ok(d.optionsDetail[0].troop === 10 && d.optionsDetail[3].troop === 100, '档位映射正确(10..100)');
    }
  }

  // ===== 4) 单词不够 -> 拒绝开房 =====
  log('=== 4) 单词不够时拒绝开高档房（用 sprite，只有 5 词）===');
  const tokenS = await login('sprite');
  if (tokenS) {
    // sprite 只有 5 个健康词 -> 押 20（需 20 词）应被拒
    const r = await req('POST', '/battle/room/create', { bet: 20 }, tokenS);
    ok(r.status === 400 || (r.body && r.body.code !== 200), '押 20（需20词）被拒绝');
    log('  返回: ' + JSON.stringify(r.body && (r.body.msg || r.body.message)));
    const m = String((r.body && (r.body.msg || r.body.message)) || '');
    ok(/不够|只有/.test(m), '错误文案提到单词不够');
  } else {
    ok(false, 'sprite 登录失败');
  }

  // ===== 5) /battle/gold/bets 也带详情 =====
  log('=== 5) /battle/gold/bets 返回档位详情 ===');
  if (token) {
    const r = await req('GET', '/battle/gold/bets', null, token);
    ok(r.status === 200 && r.body && r.body.code === 200, 'gold/bets 200');
    const d = (r.body && r.body.data) || {};
    ok(Array.isArray(d.optionsDetail), 'gold/bets 有 optionsDetail');
    ok(typeof d.myWords === 'number', 'gold/bets 有 myWords');
  }

  log('\n========== 结果: ' + pass + ' passed, ' + fail + ' failed ==========');
  out.end();
  setTimeout(() => { console.log('pass=' + pass + ' fail=' + fail + ' log=' + LOG); process.exit(fail ? 1 : 0); }, 200);
})();
