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
    // 艾宾浩斯遗忘曲线喂养间隔（毫秒）
    // Lv.1=20分钟, Lv.2=12小时, Lv.3=1天, Lv.4=2天, Lv.5=4天, Lv.6=7天, Lv.7=15天
    feedIntervals: [
      20 * 60 * 1000,          // Lv.1: 20分钟
      12 * 60 * 60 * 1000,     // Lv.2: 12小时
      24 * 60 * 60 * 1000,     // Lv.3: 1天
      2 * 24 * 60 * 60 * 1000, // Lv.4: 2天
      4 * 24 * 60 * 60 * 1000, // Lv.5: 4天
      7 * 24 * 60 * 60 * 1000, // Lv.6: 7天
      15 * 24 * 60 * 60 * 1000, // Lv.7: 15天
    ],
    // 饥饿窗口期：到点后2小时内必须喂养，否则饥饿
    hungerWindowMs: 2 * 60 * 60 * 1000,
    // 饥饿后降级等待时间：1小时不喂就降级
    downgradeThresholdMs: 1 * 60 * 60 * 1000,
    // 最大等级
    maxLevel: 8,
    // 每个喂养窗口需拼写正确3次
    feedSpellCount: 3,
    // Lv.1 需要喂养2次才能升到Lv.2
    maxLv1FeedCount: 2,
    // 变成单词蛋的阈值（超时30天）
    eggThresholdMs: 30 * 24 * 60 * 60 * 1000,
    // 收服所需正确次数
    catchRequiredCorrect: 6,
    // 喂养窗口长度
    feedWindowMs: 2 * 60 * 60 * 1000,
    // 拼写错误后补救喂养延迟
    remedialFeedDelayMs: 2 * 60 * 60 * 1000,
  },
};
