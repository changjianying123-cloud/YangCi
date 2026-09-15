import { config } from '../config';
import { CardStatus, MoodType } from '../types';

/**
 * 判断是否处于饥饿状态（饥饿或降级都在此列）
 * ⚠️ 饥饿 / 降级 / 蛋 状态的卡不能玩耍，必须先喂养（或先花金币恢复）
 */
export function isHungryStatus(
  feedDeadline: number,
  feedWindowEnd: number,
  hungerStartAt: number | null,
  isEgg: boolean,
  now = Date.now()
): boolean {
  if (isEgg) return false; // 蛋是另一个终态，由 isEgg 单独拦
  if (now < feedDeadline) return false;
  if (now >= feedDeadline && now < feedWindowEnd) return false;
  return now >= feedWindowEnd;
}

/**
 * 判断是否可以玩耍
 * - 蛋：不可以（要孵化）
 * - 饥饿 / 降级：不可以（要先喂养或花金币恢复）
 * - 正规窗口内 / 还没到喂养时间：可以
 *
 * 注意：允许「还没到喂养时间」（normal）的卡玩耍，也允许「正在喂养窗口内」
 * （incubating）的卡玩耍——后者用户边玩边喂都行，不算饥饿。
 */
export function canPlayCard(
  feedDeadline: number,
  feedWindowEnd: number,
  hungerStartAt: number | null,
  isEgg: boolean,
  now = Date.now()
): boolean {
  if (isEgg) return false;
  return !isHungryStatus(feedDeadline, feedWindowEnd, hungerStartAt, isEgg, now);
}

/**
 * 获取喂养的金币收益（健康状态喂养 = 等级对应的金币）
 */
export function getFeedCoinReward(level: number): number {
  if (!config.coins.feedCoinPerLevel) return 1;
  return Math.max(1, level);
}

/**
 * 判断饥饿状态下是否需要先消耗金币恢复
 */
export function isHungryNeedCoins(status: CardStatus): boolean {
  return status === 'hungry';
}

/**
 * 检查用户是否有足够金币恢复饥饿
 */
export function canAffordRecover(coins: number): boolean {
  return coins >= config.coins.recoverCost;
}

/**
 * 计算卡牌当前状态
 */
export function computeCardStatus(
  level: number,
  feedDeadline: number,
  feedWindowEnd: number,
  hungerStartAt: number | null,
  downgradeCount: number,
  isEgg: boolean,
  now = Date.now()
): CardStatus {
  if (isEgg) return 'normal';

  if (now < feedDeadline) return 'normal';

  if (now >= feedDeadline && now < feedWindowEnd) return 'incubating';

  // 过窗口以后就是「饥饿」，一直持续到满 eggThresholdMs 变成单词蛋。
  // （曾经饥饿满 1h 会返回 'downgraded'，降级逻辑已移除）
  return 'hungry';
}

/**
 * 判断是否可以喂养（含补救窗口）
 */
export function canFeedNow(
  level: number,
  feedDeadline: number,
  feedWindowEnd: number,
  isEgg: boolean,
  remedialFeedAt: number | null = null,
  now = Date.now()
): boolean {
  if (isEgg) return false;
  if (level < 1) return false;

  // 正常窗口
  if (now >= feedDeadline && now < feedWindowEnd) return true;

  // 补救窗口
  if (remedialFeedAt && now >= remedialFeedAt) {
    const remedialEnd = remedialFeedAt + config.card.hungerWindowMs;
    if (now < remedialEnd) return true;
  }

  return false;
}

/**
 * 获取补救喂养信息
 */
export function getRemedialInfo(remedialFeedAt: number | null, now = Date.now()): {
  hasRemedial: boolean;
  canFeedRemedial: boolean;
  humanReadable: string;
} {
  if (!remedialFeedAt) return { hasRemedial: false, canFeedRemedial: false, humanReadable: '' };

  const remedialEnd = remedialFeedAt + config.card.hungerWindowMs;

  if (now < remedialFeedAt) {
    const diff = remedialFeedAt - now;
    let readable = '';
    if (diff < 60 * 1000) readable = '补救喂养即将开始';
    else if (diff < 60 * 60 * 1000) readable = `补救还剩 ${Math.ceil(diff / (60 * 1000))} 分钟`;
    else readable = `补救还剩 ${Math.ceil(diff / (60 * 60 * 1000))} 小时`;
    return { hasRemedial: true, canFeedRemedial: false, humanReadable: readable };
  }

  if (now < remedialEnd) {
    const diff = remedialEnd - now;
    let readable = '';
    if (diff < 60 * 1000) readable = '补救窗口即将关闭！';
    else readable = `补救剩余 ${Math.ceil(diff / (60 * 1000))} 分钟`;
    return { hasRemedial: true, canFeedRemedial: true, humanReadable: readable };
  }

  return { hasRemedial: false, canFeedRemedial: false, humanReadable: '' };
}

/**
 * 喂养成功后计算下一等级的时间表
 * @param lv1FeedCount Lv.1 已喂次数（用于判定是否升级）
 */
export function nextFeedSchedule(level: number, lv1FeedCount: number = 0, now = Date.now()): {
  level: number;
  feedDeadline: number;
  feedWindowEnd: number;
} {
  let newLevel: number;

  if (level === 0) {
    // 蛋孵化 → Lv.1
    newLevel = 1;
  } else if (level === 1 && lv1FeedCount < config.card.maxLv1FeedCount - 1) {
    // Lv.1 还需再喂一次，保持Lv.1
    newLevel = 1;
  } else {
    // 正常升级
    newLevel = Math.min(level + 1, config.card.maxLevel);
  }

  const idx = Math.min(Math.max(newLevel, 1), config.card.feedIntervals.length) - 1;
  const intervalMs = config.card.feedIntervals[idx];
  const feedDeadline = now + intervalMs;
  const feedWindowEnd = feedDeadline + config.card.hungerWindowMs;

  return { level: newLevel, feedDeadline, feedWindowEnd };
}

/**
 * 获取窗口信息
 */
export function getWindowInfo(feedDeadline: number, feedWindowEnd: number, now = Date.now()): {
  canFeed: boolean;
  humanReadable: string;
} {
  if (now < feedDeadline) {
    const diff = feedDeadline - now;
    let readable = '';
    if (diff < 60 * 1000) readable = '即将可以喂养';
    else if (diff < 60 * 60 * 1000) readable = `${Math.ceil(diff / (60 * 1000))}分钟后可以喂养`;
    else if (diff < 24 * 60 * 60 * 1000) readable = `${Math.ceil(diff / (60 * 60 * 1000))}小时后可以喂养`;
    else readable = `${Math.ceil(diff / (24 * 60 * 60 * 1000))}天后可以喂养`;
    return { canFeed: false, humanReadable: readable };
  }
  if (now < feedWindowEnd) return { canFeed: true, humanReadable: '🍼 可喂养' };
  return { canFeed: false, humanReadable: '⏰ 已超时' };
}

export function buildAudioUrl(word: string, audioUrl?: string | null): string {
  if (audioUrl) return audioUrl;
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
}

/**
 * 获取心情emoji
 */
export function getMoodEmoji(mood: MoodType): string {
  const map: Record<MoodType, string> = {
    happy: '😊',
    sad: '😢',
    none: '😐',
  };
  return map[mood] || '';
}

/**
 * 判断是否为Lv.1
 */
export function getLv1Info(level: number, feedSpellCount: number): { isLv1: boolean; progress: number } {
  if (level === 1) return { isLv1: true, progress: feedSpellCount };
  return { isLv1: false, progress: 0 };
}
