const m = require('mysql2/promise');
(async () => {
  const c = await m.createConnection({host:'127.0.0.1', user:'root', password:'cjy123com', database:'word_app'});
  const [r] = await c.query("SELECT COUNT(*) as c FROM words WHERE meaning=word OR phonetic IS NULL OR phonetic=''");
  console.log('剩余未补:', r[0].c);
  if (r[0].c > 0) {
    const [w] = await c.query("SELECT id, word, meaning FROM words WHERE meaning=word OR phonetic IS NULL OR phonetic='' LIMIT 5");
    console.log('示例:', w);
  } else {
    // 验证一下数据质量
    const [s] = await c.query("SELECT word, meaning, phonetic FROM words LIMIT 10");
    console.log('数据样本:', s);
  }
  await c.end();
})();
