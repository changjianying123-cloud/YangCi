import { request } from '@/utils/request.js';

// 微信小程序登录：静默换取 code
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

/**
 * 登录（自动路由）：有 username/password 走账号登录，否则 code（微信/游客）
 */
export function login(payload) {
  if (payload && (payload.username !== undefined || payload.password !== undefined)) {
    // 账号密码登录
    return request('/auth/login', { method: 'POST', data: {
      username: payload.username,
      password: payload.password,
    }});
  }
  // code 登录（微信 / 开发游客）
  const code = (payload && payload.code) || 'dev_mock';
  // #ifdef MP-WEIXIN
  return wxLogin()
    .then((wxCode) => request('/auth/login', { method: 'POST', data: { code: wxCode || 'dev_mock' } }))
    .catch(() => request('/auth/login', { method: 'POST', data: { code: 'dev_mock' } }));
  // #endif
  // #ifndef MP-WEIXIN
  return request('/auth/login', { method: 'POST', data: { code } });
  // #endif
}

/** 微信小程序静默登录（仅在微信环境可用） */
export function silentWxLogin() {
  // #ifdef MP-WEIXIN
  return wxLogin()
    .then((wxCode) => request('/auth/login', { method: 'POST', data: { code: wxCode || 'dev_mock' }, silent: true }))
    .catch(() => {
      return request('/auth/login', { method: 'POST', data: { code: 'dev_mock' }, silent: true });
    });
  // #endif
  // #ifndef MP-WEIXIN
  return Promise.reject(new Error('非微信环境'));
  // #endif
}

/** 账号密码注册 */
export function register(data) {
  return request('/auth/register', { method: 'POST', data });
}

export function getProfile() {
  return request('/auth/profile');
}

export function updateProfile(data) {
  return request('/auth/profile', { method: 'PUT', data });
}

export function logout() {
  return request('/auth/logout', { method: 'POST' });
}
