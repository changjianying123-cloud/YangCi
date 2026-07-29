import { request } from '@/utils/request.js';

export function getRandomWord(bookCode) {
  return request(`/word/random?book_code=${bookCode}`);
}

export function catchWord(wordId, correctCount) {
  return request('/word/catch', {
    method: 'POST',
    data: { word_id: wordId, correct_count: correctCount },
  });
}

export function getWordDetail(wordId) {
  return request(`/word/${wordId}`);
}
