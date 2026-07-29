import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'word_app',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'yangci_dev_secret',
    expiresIn: '7d',
  },
  wx: {
    appId: process.env.WX_APPID || '',
    secret: process.env.WX_SECRET || '',
  },
  devMockWx: process.env.DEV_MOCK_WX !== 'false',
  importSecret: process.env.IMPORT_SECRET || 'yangci_import_dev',
  card: {
    feedIntervals: [
      2 * 60 * 1000,          // Lv.1: 2分钟（测试用）
      10 * 60 * 1000,         // Lv.2: 10分钟
      60 * 60 * 1000,         // Lv.3: 1小时（测试用）
      120 * 60 * 1000,        // Lv.4: 2小时
      240 * 60 * 1000,        // Lv.5: 4小时
    ],
    feedSpellCount: 3,
    downgradeThresholdMs: 24 * 60 * 60 * 1000,
    eggThresholdMs: 72 * 60 * 60 * 1000,
    maxLevel: 5,
    catchRequiredCorrect: 6,
    feedWindowMs: 2 * 60 * 60 * 1000,
  },
};
