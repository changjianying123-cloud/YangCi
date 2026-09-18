import { request } from '@/utils/request.js';

export function getCardList() {
  return request('/card/list');
}

export function getPendingCards() {
  return request('/card/pending');
}

export function getCardCount() {
  return request('/card/count');
}

export function getCardDetail(cardId) {
  return request(`/card/${cardId}`);
}

export function feedCard(cardId, payload) {
  return request(`/card/${cardId}/feed`, {
    method: 'POST',
    data: payload,
  });
}

export function hatchEgg(cardId) {
  return request(`/card/${cardId}/hatch`, {
    method: 'POST',
  });
}

export function abandonCard(cardId) {
  return request(`/card/${cardId}/abandon`, {
    method: 'POST',
  });
}

export function recoverHunger(cardId) {
  return request('/card/recover-hunger', {
    method: 'POST',
    data: { card_id: cardId },
  });
}

/** 玩耍：取题。mode='pick' 返回四选一；mode='translate' 只返回英文 */
export function getPlayQuestion(cardId, mode = 'pick') {
  const q = mode && mode !== 'pick' ? `?mode=${mode}` : '';
  return request(`/card/${cardId}/play${q}`);
}

/** 玩耍：随机取另一张可玩的卡（“继续玩耍”换单词）
 *  mood='sad'|'none'|'happy' 时只在所选心情范围内换词（与列表筛选保持一致） */
export function getRandomPlayCard(excludeCardId, mood) {
  const parts = [];
  if (excludeCardId) parts.push(`exclude=${excludeCardId}`);
  if (mood) parts.push(`mood=${mood}`);
  const q = parts.length ? `?${parts.join('&')}` : '';
  return request(`/card/play/random${q}`);
}

/** 喂养：找下一张可喂养的卡（用完不用退回列表，直接接着喂）
 *  hungryOnly=true 时只找饥饿中的卡 */
export function getNextFeedCard(excludeCardId, hungryOnly) {
  const parts = [];
  if (excludeCardId) parts.push(`exclude=${excludeCardId}`);
  if (hungryOnly) parts.push('hungry=1');
  const q = parts.length ? `?${parts.join('&')}` : '';
  return request(`/card/feed/next${q}`);
}

/** 玩耍：交答案。mode='translate' 时走容错判分 */
export function submitPlayAnswer(cardId, answer, mode = 'pick') {
  return request(`/card/${cardId}/play`, {
    method: 'POST',
    data: { answer, mode },
  });
}
