const CACHE_PREFIX = 'yangci_cache_';
const DEFAULT_TTL = 5 * 60 * 1000;

export function setCache(key, data, ttl = DEFAULT_TTL) {
  uni.setStorageSync(CACHE_PREFIX + key, {
    data,
    expireAt: Date.now() + ttl,
  });
}

export function getCache(key) {
  const cached = uni.getStorageSync(CACHE_PREFIX + key);
  if (!cached) return null;
  if (cached.expireAt < Date.now()) {
    uni.removeStorageSync(CACHE_PREFIX + key);
    return null;
  }
  return cached.data;
}

export function formatDeadline(ts) {
  if (!ts) return '-';
  const diff = ts - Date.now();
  if (diff <= 0) return '已到期';
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 1) return '即将可以喂养';
  if (hours < 24) return `${hours}小时后`;
  const days = Math.floor(hours / 24);
  return `${days}天后`;
}

export function cardStatusText(status) {
  const map = {
    incubating: '可喂养',
    hungry: '饥饿',
    downgraded: '降级',
    egg: '单词蛋',
    normal: '健康',
  };
  return map[status] || status;
}

export function cardStatusColor(status) {
  const map = {
    incubating: '#FF9800',
    hungry: '#F44336',
    downgraded: '#9C27B0',
    egg: '#9E9E9E',
    normal: '#4CAF50',
  };
  return map[status] || '#666';
}

/**
 * 艾宾浩斯遗忘曲线等级标签
 */
export function levelLabel(level) {
  if (level === 0) return '🥚 蛋';
  const labels = [
    '',
    '🕐 20分钟',
    '🕐 12小时',
    '📅 1天',
    '📅 2天',
    '📅 4天',
    '📅 7天',
    '📅 15天',
    '📅 30天',
  ];
  return labels[level] || `Lv.${level}`;
}

/**
 * 心情符号
 */
export function moodSymbol(mood) {
  const map = {
    happy: '😊',
    sad: '😢',
    none: '😐',
  };
  return map[mood] || '';
}

/**
 * 格式化金币显示
 */
export function formatCoins(coins) {
  return `💰 ${coins || 0}`;
}

/**
 * 获取饥饿恢复所需金币
 */
export function getRecoverCost() {
  return 10;
}
