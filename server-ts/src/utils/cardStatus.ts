import { config } from '../config';
import { CardStatus } from '../types';

/**
 * 根据卡牌数据库字段计算当前状态
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
  // 单词蛋状态
  if (isEgg) return 'normal';

  // 还没有到喂养开始时间
  if (now < feedDeadline) {
    return 'normal';
  }

  // 在喂养窗口期内 → 待喂养（incubating）
  if (now >= feedDeadline && now < feedWindowEnd) {
    return 'incubating';
  }

  // 超过了喂养窗口
  if (now >= feedWindowEnd) {
    // 如果饥饿开始时间已记录并且超过降级阈值 → 降级
    if (hungerStartAt && now >= hungerStartAt + config.card.downgradeThresholdMs) {
      return 'downgraded';
    }
    return 'hungry';
  }

  return 'normal';
}

/**
 * 判断卡牌是否可以被喂养
 * 必须在喂养窗口开启时间内
 */
export function canFeedNow(
  level: number,
  feedDeadline: number,
  feedWindowEnd: number,
  isEgg: boolean,
  now = Date.now()
): boolean {
  if (isEgg) return false;
  if (level < 1) return false;
  if (level < 1) return false;
  return now >= feedDeadline && now < feedWindowEnd;
}

/**
 * 根据当前等级计算下一次喂养的截止时间和窗口结束时间
 */
export function nextFeedSchedule(level: number, now = Date.now()): {
  level: number;
  feedDeadline: number;
  feedWindowEnd: number;
} {
  const intervals = config.card.feedIntervals;
  const newLevel = Math.min(level + 1, config.card.maxLevel);
  const idx = Math.min(newLevel, intervals.length) - 1;
  const intervalMs = intervals[Math.max(idx, 0)];
  const feedDeadline = now + intervalMs;
  const feedWindowEnd = feedDeadline + config.card.feedWindowMs;
  return { level: newLevel, feedDeadline, feedWindowEnd };
}

/**
 * 降级后计算新的喂养计划
 * 降级后回到前一等级，立即开放喂养窗口
 */
export function downgradeSchedule(currentLevel: number, now = Date.now()): {
  level: number;
  feedDeadline: number;
  feedWindowEnd: number;
} {
  const newLevel = Math.max(currentLevel - 1, 1);
  const idx = Math.min(newLevel, config.card.feedIntervals.length) - 1;
  const intervalMs = config.card.feedIntervals[Math.max(idx, 0)];
  const feedDeadline = now;
  const feedWindowEnd = feedDeadline + config.card.feedWindowMs;
  return { level: newLevel, feedDeadline, feedWindowEnd };
}

export function buildAudioUrl(word: string, audioUrl?: string | null): string {
  if (audioUrl) return audioUrl;
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
}
