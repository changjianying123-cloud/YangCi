import { request } from '@/utils/request.js';

/** 查某单词的全部可见助记（官方 + 其他用户发布的） */
export function listMnemonics(wordId) {
  return request(`/mnemonic/word/${wordId}`);
}

/** 批量取助记（收服/喂养时预加载用） */
export function batchMnemonics(wordIds) {
  return request('/mnemonic/batch', {
    method: 'POST',
    data: { wordIds },
  });
}

/** 发布自己的助记 */
export function createMnemonic(wordId, data) {
  return request(`/mnemonic/word/${wordId}`, {
    method: 'POST',
    data,
  });
}

/** 编辑自己的助记 */
export function updateMnemonic(id, data) {
  return request(`/mnemonic/${id}`, {
    method: 'PUT',
    data,
  });
}

/** 删除自己的助记 */
export function deleteMnemonic(id) {
  return request(`/mnemonic/${id}`, {
    method: 'DELETE',
  });
}

/** 点赞 / 取消点赞 */
export function toggleMnemonicLike(id) {
  return request(`/mnemonic/${id}/like`, { method: 'POST' });
}
