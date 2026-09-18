import axios from 'axios';
import { ElMessage } from 'element-plus';

const api = axios.create({
  baseURL: '/api',
  timeout: 20000,
});

export const TOKEN_KEY = 'yangci_admin_token';

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => {
    const body = res.data || {};
    if (body.code && body.code !== 200) {
      ElMessage.error(body.msg || '请求失败');
      return Promise.reject(body);
    }
    return body;
  },
  (err) => {
    const status = err?.response?.status;
    const body = err?.response?.data;
    if (status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('yangci_admin_user');
      if (!location.hash.includes('/login')) {
        location.hash = '#/login';
      }
    }
    ElMessage.error(body?.msg || (status === 403 ? '无权限' : '网络异常'));
    return Promise.reject(err);
  }
);

// ===== 登录 =====
export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  profile: () => api.get('/auth/profile'),
  // 首个管理员初始化（库里没有管理员时，把自己提权）
  bootstrap: () => api.post('/admin/bootstrap'),
};

// ===== 概览 / 统计 =====
export const dashApi = {
  dashboard: () => api.get('/admin/dashboard'),
  trend: (days = 14) => api.get('/admin/stats/trend', { params: { days } }),
  online: () => api.get('/admin/online'),
};

// ===== 单词 =====
export const wordApi = {
  list: (params) => api.get('/admin/words', { params }),
  create: (data) => api.post('/admin/words', data),
  update: (id, data) => api.put(`/admin/words/${id}`, data),
  remove: (id) => api.delete(`/admin/words/${id}`),
  books: () => api.get('/admin/books'),

  // 助记（一个单词可多个）
  mnemonics: (wordId) => api.get(`/admin/words/${wordId}/mnemonics`),
  addMnemonic: (wordId, data) => api.post(`/admin/words/${wordId}/mnemonics`, data),
  updateMnemonic: (id, data) => api.put(`/admin/mnemonics/${id}`, data),
  removeMnemonic: (id) => api.delete(`/admin/mnemonics/${id}`),

  // 导入 / 导出
  importWords: (csv, mode = 'append') => api.post('/admin/words/import', { csv, mode }),
};

/** 下载导出/模板文件（带 token，走 blob，避免直接开新窗口拿不到鉴权） */
export async function downloadCsv(path, filename) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    ElMessage.error('下载失败: HTTP ' + res.status);
    throw new Error('download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===== 用户 =====
export const userApi = {
  list: (params) => api.get('/admin/users', { params }),
  detail: (id) => api.get(`/admin/users/${id}`),
  update: (id, data) => api.put(`/admin/users/${id}`, data),
  resetPassword: (id, password) => api.post(`/admin/users/${id}/reset-password`, { password }),
};

// ===== 日志 =====
export const logApi = {
  list: (params) => api.get('/admin/logs', { params }),
};

export default api;
