const BASE_URL = 'http://localhost:3000/api';
const TOKEN_KEY = 'yangci_token';

function getToken() {
  return uni.getStorageSync(TOKEN_KEY) || '';
}

export function setToken(token) {
  uni.setStorageSync(TOKEN_KEY, token);
}

export function clearToken() {
  uni.removeStorageSync(TOKEN_KEY);
}

export function request(url, options = {}) {
  const token = getToken();
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header || {}),
      },
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode === 401) {
          clearToken();
          uni.$emit('auth:expired');
        }
        if (body.code && body.code !== 200) {
          if (options.silent) {
            resolve(body);
          } else {
            uni.showToast({ title: body.msg || '请求失败', icon: 'none' });
            reject(body);
          }
          return;
        }
        resolve(body);
      },
      fail: (err) => {
        if (!options.silent) {
          uni.showToast({ title: '网络异常', icon: 'none' });
        }
        reject(err);
      },
    });
  });
}

export { BASE_URL, TOKEN_KEY, getToken };
