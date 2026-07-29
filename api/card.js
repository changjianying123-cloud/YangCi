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
