const fs = require('fs');
const path = require('path');

const high_cont = [
  'sound','source','sovereign','sow','spacecraft','span','spare','spark','sparkle',
  'spatial','spear','specialize','species','specific','specification','specimen',
  'spectacle','spectacular','spectator','spectrum','speculate','sphere','spice',
  'spill','spin','spine','spiral','spirit','spiritual','splash','split','spoil',
  'spokesman','sponsor','spot','spotlight','spouse','spray','sprout','spur',
  'squad','squeeze','stability','stabilize','stable','stadium','staff','stagger',
  'stain','staircase','stake','stale','stalk','stall','stamp','standpoint',
  'staple','stark','startle','starve','statement','statesman','stationary',
  'statistical','statue','status','statute','steadily','steady','steep','steer',
  'stem','stereotype','stern','steward','sticky','stiff','stimulate','stimulus',
  'sting','stir','stitch','stock','stockpile','stoop','storage','strain','strand',
  'strategic','strategy','straw','stray','streak','streamline','strengthen',
  'stress','stretch','stride','strife','striking','stringent','strip','strive',
  'stroke','structure','struggle','stubborn','studio','stuff','stumble','stun',
  'sturdy','subjective','submarine','submerge','submit','subordinate','subscribe',
  'subsequent','subsidy','substance','substantial','substitute','subtle','subtract',
  'suburb','subway','succession','successive','successor','suck','sue','suffice',
  'sufficient','suggestion','suicide','suitcase','suite','sum','summarize',
  'summit','summon','superb','superficial','superintendent','superior','superiority',
  'supersonic','supervise','supplement','supply','support','suppose','suppress',
  'supreme','surge','surgeon','surgery','surpass','surplus','surrender','surround',
  'survey','survival','survive','susceptible','suspect','suspend','suspense',
  'suspension','suspicious','sustain','swallow','swamp','swap','sway','swell',
  'swift','swing','switch','symbol','symmetry','sympathy','symphony','symposium',
  'symptom','syndrome','synthesis','synthetic','systematic','tablet','taboo',
  'tackle','tactic','talent','tame','tan','tangle','tap','target','tariff',
  'tease','technician','technique','technology','tedious','telescope','temper',
  'temperature','temple','temporary','tempt','tend','tendency','tender','tense',
  'tension','tentative','tenure','terminal','terminate','terrain','terrific',
  'territory','testify','testimony','textile','texture','therapy','thereafter',
  'thereby','thermal','thesis','thorough','thoughtful','thrash','threshold',
  'thrill','thrive','throne','thrust','thumb','tick','tighten','tile','timber',
  'timeframe','timely','timid','tissue','token','tolerance','tolerate','toll',
  'topsoil','torch','torture','toss','tough','tournament','tow','toxic','tract',
  'tragedy','trail','trait','transaction','transcend','transcript','transfer',
  'transform','transit','transition','translate','transmission','transparent',
  'transplant','transport','trap','trauma','treasure','treaty','tremble','tremendous',
  'trench','trend','trial','triangle','tribe','tribute','trigger','triple',
  'trivial','troop','tropical','tuition','tumble','tune','tunnel','turbulence',
  'turmoil','turnover','tutor','twist','ultimate','ultimatum','unanimous',
  'unavoidable','unbiased','uncomfortable','unconscious','uncover','underestimate',
  'undergo','undergraduate','underlie','undermine','undertake','undo','undoubtedly',
  'uneasy','unemployment','unexpected','unfold','unforeseen','unfortunate',
  'unify','unique','universal','universe','unknown','unlike','unlikely','unload',
  'unprecedented','unpredictable','unravel','unrest','unsettle','unsustainable',
  'unveil','update','upgrade','uphold','uprising','uproar','upset','urban','urge',
  'urgent','usage','utensil','utilize','utmost','utter','vacant','vaccine',
  'vacuum','vague','valid','validate','validity','valley','valuable','value',
  'valve','vanish','variable','variation','variety','various','vary','vase',
  'vast','vegetation','vehicle','veil','vein','velocity','vendor','venture',
  'venue','verbal','verdict','verify','versatile','verse','version','versus',
  'vertical','vessel','veteran','veto','viable','vibrant','vibrate','vice',
  'victim','victory','video','viewpoint','vigorous','village','violate','violence',
  'violent','virtual','virtue','virus','visa','visible','vision','visual',
  'vital','vitamin','vivid','vocabulary','vocal','vocational','void','volatile',
  'volume','voluntary','volunteer','voucher','vow','vulnerable','wage','wagon',
  'waive','ward','warehouse','warfare','warrant','warrior','wary','waterproof',
  'wavelength','wax','wealthy','weapon','weary','weave','web','wedge','weed',
  'weird','welfare','welfare','whereas','whereby','whip','whirl','wholesale',
  'widespread','wilderness','willpower','wilt','wink','wisdom','withdraw',
  'withhold','witness','workforce','workplace','workshop','worship','worthwhile',
  'wound','wrap','wreath','wreck','wrench','wrestle','wrinkle','writing','yell',
  'yield','youngster','zone',
];

const lines = [];
lines.push('-- Word seeds for YangCi - Batch Import');
lines.push('SET @primary_id = (SELECT id FROM books WHERE book_code = \'primary\');');
lines.push('SET @middle_id = (SELECT id FROM books WHERE book_code = \'middle\');');
lines.push('SET @high_id = (SELECT id FROM books WHERE book_code = \'high\');');
lines.push('');

function escape(v) { return v.replace(/'/g, "''"); }

// Read primary words from the other file
function makeInserts(bookVar, words, batchSize) {
  const lines = [];
  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize);
    const rows = batch.map(w => {
      const audio = 'https://dict.youdao.com/dictvoice?audio=' + w + '&type=2';
      return '(' + bookVar + ", '" + escape(w) + "', '\\"" + escape(w) + "\\"', '" + escape(audio) + "')";
    });
    lines.push('INSERT IGNORE INTO words (book_id, word, meaning, audio_url) VALUES');
    lines.push('  ' + rows.join(',\n  ') + ';');
    lines.push('');
  }
  return lines;
}

// Primary
lines.push('-- Primary School');
const primarySql = makeInserts('@primary_id', primary, 200);
lines.push(...primarySql);

// Middle 
lines.push('-- Middle School');
const middleSql = makeInserts('@middle_id', middle, 200);
lines.push(...middleSql);

// High
lines.push('-- High School');
const highSql = makeInserts('@high_id', high_cont, 200);
lines.push(...highSql);

// Update counts
lines.push('-- Update word counts');
lines.push("UPDATE books SET total_words = (SELECT COUNT(*) FROM words WHERE book_id = @primary_id) WHERE book_code = 'primary';");
lines.push("UPDATE books SET total_words = (SELECT COUNT(*) FROM words WHERE book_id = @middle_id) WHERE book_code = 'middle';");
lines.push("UPDATE books SET total_words = (SELECT COUNT(*) FROM words WHERE book_id = @high_id) WHERE book_code = 'high';");
lines.push('');

const fp = path.join(__dirname, 'seed_words_full.sql');
fs.writeFileSync(fp, lines.join('\n'), 'utf8');
console.log('Generated seed_words_full.sql');
console.log('Primary:', primary.length, 'Middle:', middle.length, 'High:', high_cont.length);
console.log('Total:', primary.length + middle.length + high_cont.length);
