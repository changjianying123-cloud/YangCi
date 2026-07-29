/**
 * 补数据脚本：用有道词典 API 补充 words 表的中文释义和音标
 * 
 * 运行方式：cd server-ts && node scripts/fixMeanings.cjs
 * 策略：分批次查询，每次查一批词，有速限时等待
 * 默认只处理 meaning=word（即未补过）的词
 */

const mysql = require('mysql2/promise');
const https = require('https');
const http = require('http');

const DB = { host: '127.0.0.1', user: 'root', password: 'cjy123com', database: 'word_app' };
const BATCH_SIZE = 10;   // 并发请求数
const DELAY_MS = 200;     // 每批间隔

// 从有道词典取释义和音标
function fetchYoudao(word) {
  return new Promise((resolve, reject) => {
    const url = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(word) + '&le=en&t=8';
    https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const w = j.ec?.word?.[0];
          if (!w) {
            resolve({ phonetic: '', meaning: '' });
            return;
          }
          const phonetic = w.ukphone || w.usphone || '';
          const trs = w.trs || [];
          const meanings = trs.map(t => t.tr?.[0]?.l?.i?.[0]).filter(Boolean);
          const meaning = meanings.join('；');
          resolve({ phonetic: '/' + phonetic + '/' || '', meaning: meaning || '' });
        } catch(e) { resolve({ phonetic: '', meaning: '' }); }
      });
    }).on('error', (e) => resolve({ phonetic: '', meaning: '' }))
      .on('timeout', function() { this.destroy(); resolve({ phonetic: '', meaning: '' }); });
  });
}

async function main() {
  const conn = await mysql.createConnection(DB);
  
  // 找出所有需要补数据的词（meaning=word 或 phonetic 为空）
  const [rows] = await conn.execute(
    "SELECT id, word, meaning, phonetic FROM words WHERE meaning = word OR phonetic IS NULL OR phonetic = ''"
  );
  console.log('需要补数据的词数:', rows.length);
  
  let updated = 0;
  let failed = 0;
  
  // 分批处理
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const promises = batch.map(row => fetchYoudao(row.word));
    
    const results = await Promise.all(promises);
    
    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];
      const result = results[j];
      
      if (result.meaning) {
        await conn.execute(
          'UPDATE words SET meaning = ?, phonetic = ? WHERE id = ?',
          [result.meaning, result.phonetic, row.id]
        );
        updated++;
      } else {
        failed++;
      }
    }
    
    if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= rows.length) {
      const pct = Math.min(100, Math.round((i + BATCH_SIZE) / rows.length * 100));
      console.log(`进度: ${pct}% (${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}), 已更新: ${updated}, 失败: ${failed}`);
    }
    
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  
  console.log(`\n完成！更新: ${updated} 词, 失败: ${failed} 词`);
  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
