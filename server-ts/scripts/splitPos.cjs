/**
 * 批量拆分词性：从 words.meaning 的开头/内部 "xxx." 标记提取词性，写入 words.pos。
 *
 * 用法：
 *   node scripts/splitPos.cjs            # dry-run，只统计不写库
 *   node scripts/splitPos.cjs --apply    # 实际写库（会先备份原 pos 到 _pos_backup_<ts>.json）
 *
 * 规则：
 *   - 识别形如 n. / v. / vt. / vi. / adj. / adv. 的标记（前面可以是行首或任意非字母字符）
 *   - 映射到战斗用英文标准名：n→noun, v/vt/vi→verb, adj→adjective, adv→adverb
 *   - 一词多性用逗号连接，顺序按 noun,verb,adjective,adverb 稳定排序
 *   - meaning 原文不改动
 *   - 提取不到词性的保持原 pos（若原来为空则留空）
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const MAP = { n: 'noun', noun: 'noun', v: 'verb', vt: 'verb', vi: 'verb', verb: 'verb', adj: 'adjective', adjective: 'adjective', adv: 'adverb', adverb: 'adverb' };
const ORDER = ['noun', 'verb', 'adjective', 'adverb'];

function extractPos(meaning) {
  const m = String(meaning || '');
  const found = [];
  for (const mm of m.matchAll(/(?:^|[^a-zA-Z])([a-z]{1,10})\./g)) {
    const std = MAP[mm[1].toLowerCase()];
    if (std && !found.includes(std)) found.push(std);
  }
  found.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return found.join(',');
}

(async () => {
  const APPLY = process.argv.includes('--apply');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || 'cjy123com',
    database: process.env.DB_NAME || 'word_app',
  });
  const [rows] = await pool.query('SELECT id, word, pos, meaning FROM words ORDER BY id');
  const updates = [], backups = [];
  let noPos = 0, changed = 0, same = 0;
  for (const r of rows) {
    const np = extractPos(r.meaning);
    if (!np) { noPos++; continue; }
    if ((r.pos || '') === np) { same++; continue; }
    updates.push({ id: r.id, pos: np });
    backups.push({ id: r.id, word: r.word, oldPos: r.pos, newPos: np });
    changed++;
  }
  console.log(`总 ${rows.length} 条 | 将更新 ${changed} | 已一致 ${same} | 无词性跳过 ${noPos}`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未写库。样例(前 15 条待更新):');
    backups.slice(0, 15).forEach(b => console.log(`  #${b.id} ${b.word}: ${JSON.stringify(b.oldPos)} -> ${JSON.stringify(b.newPos)}`));
    console.log('\n加 --apply 实际写入。');
    await pool.end();
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bakFile = path.join(__dirname, `_pos_backup_${ts}.json`);
  fs.writeFileSync(bakFile, JSON.stringify(backups, null, 2));
  console.log(`已备份 ${backups.length} 条原值到 ${bakFile}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let n = 0;
    for (const u of updates) {
      await conn.execute('UPDATE words SET pos = ? WHERE id = ?', [u.pos, u.id]);
      n++;
    }
    await conn.commit();
    console.log(`✅ 已更新 ${n} 条 words.pos`);
  } catch (e) {
    await conn.rollback();
    console.error('❌ 写入失败已回滚:', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
