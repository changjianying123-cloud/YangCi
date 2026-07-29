import { request } from '@/utils/request.js';

export function getBookList() {
  return request('/book/list');
}

export function getBookDetail(bookCode) {
  return request(`/book/${bookCode}`);
}
