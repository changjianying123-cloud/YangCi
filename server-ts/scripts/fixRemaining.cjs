// 继续补剩余词的释义/音标
const mysql = require('mysql2/promise');
const https = require('https');
const DB = { host:'127.0.0.1', user:'root', password:'cjy123com', database:'word_app' };

function fetchYoudao(word) {
  return new Promise((resolve) => {
    https.get('https://dict.youdao.com/jsonapi?q='+encodeURIComponent(word)+'&le=en&t=8',{timeout:8000},(res)=>{
      let d='';
      res.on('data',c=>d+=c);
      res.on('end',()=>{
        try{
          const j=JSON.parse(d);
          const w=j.ec?.word?.[0];
          if(!w) return resolve({phonetic:'',meaning:''});
          const ph=w.ukphone||w.usphone||'';
          const trs=w.trs||[];
          const m=trs.map(t=>t.tr?.[0]?.l?.i?.[0]).filter(Boolean).join('；');
          resolve({phonetic: ph?'/'+ph+'/':'', meaning: m||''});
        }catch(e){resolve({phonetic:'',meaning:''});}
      });
    }).on('error',()=>resolve({phonetic:'',meaning:''}))
      .on('timeout',function(){this.destroy();resolve({phonetic:'',meaning:''});});
  });
}

(async()=>{
  const conn=await mysql.createConnection(DB);
  const [rows]=await conn.execute("SELECT id,word FROM words WHERE meaning=word OR phonetic IS NULL OR phonetic=''");
  console.log('剩余:',rows.length);
  let up=0,fail=0;
  for(let i=0;i<rows.length;i+=10){
    const batch=rows.slice(i,i+10);
    const res=await Promise.all(batch.map(r=>fetchYoudao(r.word)));
    for(let j=0;j<batch.length;j++){
      if(res[j].meaning){
        await conn.execute('UPDATE words SET meaning=?,phonetic=? WHERE id=?',[res[j].meaning,res[j].phonetic,batch[j].id]);
        up++;
      }else fail++;
    }
    if((i+10)%200===0||i+10>=rows.length){
      console.log(Math.min(100,Math.round((i+10)/rows.length*100))+'% ('+(i+10)+'/'+rows.length+'), 更新:'+up+', 失败:'+fail);
    }
    await new Promise(r=>setTimeout(r,200));
  }
  console.log('完成! 更新:'+up+', 失败:'+fail);
  await conn.end();
})().catch(e=>{console.error(e);process.exit(1);});
