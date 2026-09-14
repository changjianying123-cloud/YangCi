import { request } from '@/utils/request.js';

export function startBattle() {
  return request('/battle/ai/start', { method: 'POST' });
}

export function getBattle(battleId, silent = true) {
  return request(`/battle/${battleId}`, { method: 'GET', silent });
}

// 布阵：开战前提交我方出场顺序 order=[cardId,...]
export function deployBattle(battleId, order) {
  return request(`/battle/${battleId}/deploy`, { method: 'POST', data: { order } });
}

// payload: { kind:'skill'|'revive', unit_card_id, target_card_id?, spell_correct }
export function battleAct(battleId, payload, silent = true) {
  return request(`/battle/${battleId}/act`, { method: 'POST', data: payload, silent });
}

// ===== 金币场（真人 PvP）=====
export function goldBets() {
  return request('/battle/gold/bets', { method: 'GET' });
}
export function goldJoin(bet) {
  return request('/battle/gold/join', { method: 'POST', data: { bet } });
}
export function goldQueue(silent = true) {
  return request('/battle/gold/queue', { method: 'GET', silent });
}
export function goldCancel() {
  return request('/battle/gold/cancel', { method: 'POST' });
}

// ===== 金币场（房间制）=====
export function roomBets() {
  return request('/battle/room/bets', { method: 'GET' });
}
export function roomList(silent = true) {
  return request('/battle/room/list', { method: 'GET', silent });
}
export function roomCreate(bet) {
  return request('/battle/room/create', { method: 'POST', data: { bet } });
}
export function roomJoin(roomId) {
  return request(`/battle/room/${roomId}/join`, { method: 'POST' });
}
export function roomDetail(roomId, silent = true) {
  return request(`/battle/room/${roomId}`, { method: 'GET', silent });
}
export function roomMine(silent = true) {
  return request('/battle/room/mine/current', { method: 'GET', silent });
}
export function roomReady(roomId) {
  return request(`/battle/room/${roomId}/ready`, { method: 'POST' });
}
export function roomDeploy(roomId, order) {
  return request(`/battle/room/${roomId}/deploy`, { method: 'POST', data: { order } });
}
// reason: 'leave'（主动退出）| 'home'（回大厅）
export function roomLeave(roomId, reason = 'leave') {
  return request(`/battle/room/${roomId}/leave`, { method: 'POST', data: { reason } });
}
