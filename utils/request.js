// 本地测试环境；上线时改回线上地址 https://47.251.168.98:3000/api
//https://spritecreate.com/api
//http://localhost:3000/api
// const BASE_URL = 'https://spritecreate.com/api';
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
          uni.removeStorageSync('yangci_user');
          uni.$emit('auth:expired');
          // 未登录被拒：引导去登录页（避免在登录/注册页自身重复跳）
          const pages = getCurrentPages();
          const cur = pages.length ? `/${pages[pages.length - 1].route}` : '';
          if (cur && !/\/pages\/(login|register)\//.test(cur)) {
            setTimeout(() => {
              uni.reLaunch({ url: `/pages/login/login?redirect=${encodeURIComponent(cur)}` });
            }, 300);
          }
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

/**
 * 把后端返回的相对图片地址补成绝对地址。
 * 助记/头像等图片存在 /uploads/... 下，小程序 <image> 不认相对路径，
 * 必须拼上服务端域名（BASE_URL 去掉末尾的 /api）。
 */
export function toAbsoluteUrl(url) {
  if (!url) return '';
  const s = String(url);
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  const origin = BASE_URL.replace(/\/api\/?$/, '');
  return origin + (s.startsWith('/') ? s : '/' + s);
}
