import { defineStore } from 'pinia';
import { authApi, TOKEN_KEY } from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: JSON.parse(localStorage.getItem('yangci_admin_user') || 'null'),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
  },
  actions: {
    async login(username, password) {
      const res = await authApi.login(username, password);
      const { token, user } = res.data || {};
      this.token = token;
      this.user = user;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem('yangci_admin_user', JSON.stringify(user));
      return user;
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('yangci_admin_user');
    },
    async refreshProfile() {
      const res = await authApi.profile();
      this.user = res.data;
      localStorage.setItem('yangci_admin_user', JSON.stringify(res.data));
      return res.data;
    },
  },
});
