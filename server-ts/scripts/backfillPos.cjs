/**
 * 词性回填脚本：给 words 表回填 pos 列（noun/adjective/verb/adverb，可多个，逗号分隔）。
 *
 * 数据源：有道词典公开接口 https://dict.youdao.com/jsonapi?q=<word>
 *   - 从每条释义前缀提取词性标签(n. / v. / vi. / vt. / adj. / adv. …)
 *   - 一个词可能是多词性，例如 run = verb,noun，全部合并保存
 *   - 四种战斗词性之外(prep/conj/pron 等)不记；若四种都不含则记 'other'
 *
 * 幂等可续跑：只处理 pos IS NULL 的词；中断后重跑会自动从剩下继续。
 *
 * 用法：node -r ts-node/register ... 或编译后 node dist 下跑。本脚本直接用 JS 连接池复用 .env。
 *   更简单：node scripts/backfillPos.js  (改源文件后缀为 .cjs 即可，下方用 mysql2 require)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const CONCURRENCY = 4;        // 并发请求数
const DELAY_MS = 120;         // 每批间隔，避免触发限流
const BATCH = 50;             // 每批拉取词数

function tagsToPos(texts) {
  const roles = new Set();
  for (const t of texts || []) {
    const m = (t || '').trim().match(/^([a-z]+)\s*\./i);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    if (tag === 'n') roles.add('noun');
    else if (tag === 'v' || tag === 'vi' || tag === 'vt' || tag === 'vti' || tag === 'link-v' || tag === 'aux') roles.add('verb');
    else if (tag === 'adj') roles.add('adjective');
    else if (tag === 'adv') roles.add('adverb');
  }
  return roles;
}

async function fetchPos(word) {
  const url = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(word);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const entry = j && j.ec && j.ec.word && j.ec.word['0'];
  const texts = [];
  if (entry) {
    for (const tr of entry.trs || []) {
      for (const tt of tr.tr || []) {
        for (const it of (tt.l && tt.l.i) || []) texts.push(it);
      }
    }
  }
  if (!texts.length) throw new Error('no definition');
  return tagsToPos(texts);
}

async function processBatch(pool, words) {
  const results = await Promise.allSettled(
    words.map(async (row) => {
      const roles = await fetchPos(row.word);
      return { id: row.id, word: row.word, pos: roles.size ? Array.from(roles).sort().join(',') : 'other' };
    })
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const { id } = words[i];
    if (r.status === 'fulfilled') {
      await pool.execute('UPDATE words SET pos = ? WHERE id = ?', [r.value.pos, id]);
      console.log('ok  ', r.value.word, '->', r.value.pos);
    } else {
      console.log('FAIL', words[i].word, ':', r.reason.message);
      // 网络失败不写 pos，下次重跑会再试
    }
  }
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'word_app',
    charset: 'utf8mb4',
  });
  const onlyCaptured = !process.argv.includes('--all');
  // 默认只回填“玩家拥有过的词”（battle 用词池；含已遗弃的，重新激活后要能出战）；加 --all 才扫全库
  const wherePos = "(pos IS NULL OR pos='')";
  const scopeWhere = onlyCaptured
    ? wherePos + " AND id IN (SELECT DISTINCT word_id FROM user_cards)"
    : wherePos;
  const [total] = await pool.query('SELECT COUNT(*) c FROM words WHERE ' + scopeWhere);
  console.log(onlyCaptured ? '[玩家拥有过的词] ' : '[全库] ', '待回填：', total[0].c);
  if (total[0].c === 0) { console.log('无需回填'); await pool.end(); return; }

  let done = 0;
  while (true) {
    const [rows] = await pool.query(
      'SELECT id, word FROM words WHERE ' + scopeWhere + ' ORDER BY id LIMIT ?',
      [BATCH]
    );
    if (!rows.length) break;
    await processBatch(pool, rows);
    done += rows.length;
    console.log('进度', done + '/' + total[0].c);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  await pool.end();
  console.log('全部完成');
}

main().catch((e) => { console.error('脚本出错', e); process.exit(1); });
