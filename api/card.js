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

/** 玩耍：取题（英文 + 4 个中文选项） */
export function getPlayQuestion(cardId) {
  return request(`/card/${cardId}/play`);
}

/** 玩耍：交答案（answer 为选中的中文），答对提心情，答错降心情 */
export function submitPlayAnswer(cardId, answer) {
  return request(`/card/${cardId}/play`, {
    method: 'POST',
    data: { answer },
  });
}
