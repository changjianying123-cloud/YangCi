import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from './pool';

/** 幂等加列：不存在才 ALTER（兼容 MySQL 5.7/8.x） */
async function addColumnIfMissing(table: string, column: string, definition: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (((rows[0] as { n: number }).n || 0) === 0) {
    await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

const BOOKS = [
  { book_code: 'primary', book_name: '小学', icon: '📚', color: '#4CAF50', total_words: 0 },
  { book_code: 'middle', book_name: '初中', icon: '📖', color: '#2196F3', total_words: 0 },
  { book_code: 'high', book_name: '高中', icon: '🎓', color: '#9C27B0', total_words: 0 },
  { book_code: 'cet4', book_name: 'CET-4', icon: '📝', color: '#FF9800', total_words: 0 },
  { book_code: 'cet6', book_name: 'CET-6', icon: '🏆', color: '#F44336', total_words: 0 },
];

const SEED_WORDS: Record<string, Array<{ word: string; meaning: string; phonetic?: string }>> = {
  primary: [
    { word: 'apple', meaning: '苹果', phonetic: '/ˈæpl/' },
    { word: 'book', meaning: '书', phonetic: '/bʊk/' },
    { word: 'cat', meaning: '猫', phonetic: '/kæt/' },
    { word: 'dog', meaning: '狗', phonetic: '/dɔːɡ/' },
    { word: 'water', meaning: '水', phonetic: '/ˈwɔːtər/' },
  ],
  middle: [
    { word: 'abandon', meaning: '放弃；遗弃', phonetic: '/əˈbændən/' },
    { word: 'benefit', meaning: '利益；好处', phonetic: '/ˈbenɪfɪt/' },
    { word: 'challenge', meaning: '挑战', phonetic: '/ˈtʃælɪndʒ/' },
    { word: 'develop', meaning: '发展；开发', phonetic: '/dɪˈveləp/' },
    { word: 'environment', meaning: '环境', phonetic: '/ɪnˈvaɪrənmənt/' },
  ],
  high: [
    { word: 'ambiguous', meaning: '模糊的；歧义的', phonetic: '/æmˈbɪɡjuəs/' },
    { word: 'comprehensive', meaning: '全面的', phonetic: '/ˌkɒmprɪˈhensɪv/' },
    { word: 'deteriorate', meaning: '恶化', phonetic: '/dɪˈtɪəriəreɪt/' },
    { word: 'hypothesis', meaning: '假设', phonetic: '/haɪˈpɒθəsɪs/' },
    { word: 'inevitable', meaning: '不可避免的', phonetic: '/ɪnˈevɪtəbl/' },
  ],
  cet4: [
    { word: 'allocate', meaning: '分配', phonetic: '/ˈæləkeɪt/' },
    { word: 'bureaucracy', meaning: '官僚主义', phonetic: '/bjʊəˈrɒkrəsi/' },
    { word: 'controversy', meaning: '争议', phonetic: '/ˈkɒntrəvɜːsi/' },
    { word: 'diverse', meaning: '多样的', phonetic: '/daɪˈvɜːs/' },
    { word: 'elaborate', meaning: '详尽的；精心制作的', phonetic: '/ɪˈlæbərət/' },
  ],
  cet6: [
    { word: 'accommodate', meaning: '容纳；适应', phonetic: '/əˈkɒmədeɪt/' },
    { word: 'benevolent', meaning: '仁慈的', phonetic: '/bəˈnevələnt/' },
    { word: 'conspicuous', meaning: '显眼的', phonetic: '/kənˈspɪkjuəs/' },
    { word: 'detrimental', meaning: '有害的', phonetic: '/ˌdetrɪˈmentl/' },
    { word: 'exemplify', meaning: '例证；示范', phonetic: '/ɪɡˈzemplɪfaɪ/' },
  ],
};

export async function initDatabase() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      openid VARCHAR(64) NOT NULL UNIQUE,
      username VARCHAR(64) DEFAULT NULL,
      password_hash VARCHAR(255) DEFAULT NULL,
      nickname VARCHAR(64) DEFAULT NULL,
      avatar_url VARCHAR(512) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS books (
      id INT AUTO_INCREMENT PRIMARY KEY,
      book_code VARCHAR(32) NOT NULL UNIQUE,
      book_name VARCHAR(64) NOT NULL,
      icon VARCHAR(16) DEFAULT '',
      color VARCHAR(16) DEFAULT '#4A90E2',
      total_words INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS words (
      id INT AUTO_INCREMENT PRIMARY KEY,
      book_id INT NOT NULL,
      word VARCHAR(100) NOT NULL,
      phonetic VARCHAR(64) DEFAULT NULL,
      meaning TEXT NOT NULL,
      audio_url VARCHAR(512) DEFAULT NULL,
      example_sentence TEXT DEFAULT NULL,
      pos VARCHAR(64) DEFAULT NULL,
      UNIQUE KEY uk_book_word (book_id, word),
      FOREIGN KEY (book_id) REFERENCES books(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_cards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      word_id INT NOT NULL,
      level INT DEFAULT 1,
      feed_deadline BIGINT NOT NULL,
      feed_window_end BIGINT NOT NULL DEFAULT 0,
      last_feed_at BIGINT DEFAULT NULL,
      hunger_start_at BIGINT DEFAULT NULL,
      downgrade_count INT DEFAULT 0,
      is_egg TINYINT(1) DEFAULT 0,
      feed_spell_count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_word (user_id, word_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (word_id) REFERENCES words(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS feed_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      card_id INT NOT NULL,
      spell_correct TINYINT(1) DEFAULT 0,
      read_aloud_clicked TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (card_id) REFERENCES user_cards(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 单词对战记录（整局 JSON 存 state，原子更新，将来 PvP 复用同表）
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS battles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      player_user_id INT NOT NULL,
      enemy_user_id INT DEFAULT NULL,
      mode VARCHAR(8) NOT NULL DEFAULT 'ai',
      status VARCHAR(10) NOT NULL DEFAULT 'active',
      state LONGTEXT NOT NULL,
      turn_now INT DEFAULT 1,
      turn_deadline BIGINT DEFAULT 0,
      winner TINYINT(1) DEFAULT NULL,
      rewards TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP DEFAULT NULL,
      FOREIGN KEY (player_user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 金币场（真人 PvP）匹配队列：加入队列等待「同押注」对手；配对后写 battle_id
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS battle_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      nickname VARCHAR(64) DEFAULT NULL,
      bet INT NOT NULL,
      battle_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bet (bet),
      FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // battles 加 kind（新手场 rookie / 金币场 gold）+ 押注（幂等，用 information_schema 判断）
  await addColumnIfMissing('battles', 'kind', "VARCHAR(8) NOT NULL DEFAULT 'rookie' AFTER mode");
  await addColumnIfMissing('battles', 'bet', 'INT NOT NULL DEFAULT 0 AFTER kind');

  // 金币场「房间」：房主开房 → 别人加入 → 双方准备 → 双方布阵(2min) → 开战
  // status: waiting(等人) | ready_check(两人已坐等准备) | deploy(布阵中) | playing(对战中) | finished(已结束) | cancelled
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS battle_rooms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      owner_user_id INT NOT NULL,
      guest_user_id INT DEFAULT NULL,
      bet INT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'waiting',
      owner_ready TINYINT(1) DEFAULT 0,
      guest_ready TINYINT(1) DEFAULT 0,
      owner_deployed TINYINT(1) DEFAULT 0,
      guest_deployed TINYINT(1) DEFAULT 0,
      deploy_deadline BIGINT DEFAULT 0,
      battle_id INT DEFAULT NULL,
      winner_user_id INT DEFAULT NULL,
      escrowed TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_owner (owner_user_id),
      INDEX idx_guest (guest_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  for (const book of BOOKS) {
    await pool.execute<ResultSetHeader>(
      `INSERT IGNORE INTO books (book_code, book_name, icon, color, total_words) VALUES (?, ?, ?, ?, ?)`,
      [book.book_code, book.book_name, book.icon, book.color, book.total_words]
    );
  }

  for (const [bookCode, words] of Object.entries(SEED_WORDS)) {
    const [bookRows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM books WHERE book_code = ?',
      [bookCode]
    );
    if (!bookRows[0]) continue;
    const bookId = bookRows[0].id as number;

    for (const item of words) {
      await pool.execute<ResultSetHeader>(
        `INSERT IGNORE INTO words (book_id, word, phonetic, meaning, audio_url)
         VALUES (?, ?, ?, ?, NULL)`,
        [bookId, item.word, item.phonetic || null, item.meaning]
      );
    }

    const [countRows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM words WHERE book_id = ?',
      [bookId]
    );
    await pool.execute(
      'UPDATE books SET total_words = ? WHERE id = ?',
      [countRows[0].cnt, bookId]
    );
  }

  // 迁移：添加新字段
  const migrations = [
    `ALTER TABLE user_cards ADD COLUMN remedial_feed_at BIGINT DEFAULT NULL AFTER feed_spell_count`,
    `ALTER TABLE user_cards ADD COLUMN had_wrong_attempt TINYINT(1) DEFAULT 0 AFTER remedial_feed_at`,
    `ALTER TABLE user_cards ADD COLUMN abandoned TINYINT(1) DEFAULT 0 AFTER had_wrong_attempt`,
    `ALTER TABLE user_cards ADD COLUMN abandoned_at BIGINT DEFAULT NULL AFTER abandoned`,
    `ALTER TABLE users ADD COLUMN coins INT DEFAULT 0 AFTER avatar_url`,
    `ALTER TABLE users ADD COLUMN username VARCHAR(64) DEFAULT NULL AFTER openid`,
    `ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) DEFAULT NULL AFTER username`,
    `ALTER TABLE users ADD UNIQUE KEY uk_username (username)`,
    `ALTER TABLE words ADD COLUMN pos VARCHAR(64) DEFAULT NULL AFTER example_sentence`,
  ];
  // users 迁移执行完后，顺带补一次唯一索引（老表可能已有重复 null，需容错）
  try {
    await pool.execute(`ALTER TABLE users ADD UNIQUE KEY uk_username (username)`);
  } catch (_) { /* 索引已存在则忽略 */ }
  for (const sql of migrations) {
    try { await pool.execute(sql); } catch (_) { /* 列已存在则忽略 */ }
  }

  console.log('MySQL 数据库表初始化完成');
}
