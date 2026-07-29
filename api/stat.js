import { request } from '@/utils/request.js';

export function getStatOverview() {
  return request('/stat/overview');
}
