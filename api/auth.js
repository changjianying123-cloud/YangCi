import { request } from '@/utils/request.js';

// #ifdef MP-WEIXIN
export function wxLogin() {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (res) => resolve(res.code),
      fail: reject,
    });
  });
}
// #endif

export function login() {
  // #ifdef MP-WEIXIN
  return wxLogin()
    .then((code) => request('/auth/login', { method: 'POST', data: { code: code || 'dev_mock' } }))
    .catch(() => request('/auth/login', { method: 'POST', data: { code: 'dev_mock' } }));
  // #endif
  // #ifndef MP-WEIXIN
  return request('/auth/login', { method: 'POST', data: { code: 'dev_mock' } });
  // #endif
}

export function getProfile() {
  return request('/auth/profile');
}

export function updateProfile(data) {
  return request('/auth/profile', { method: 'PUT', data });
}
