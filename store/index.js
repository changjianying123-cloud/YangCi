import Vue from 'vue';
import { login as apiLogin } from '@/api/auth.js';
import { getBookList } from '@/api/book.js';
import { getCardList } from '@/api/card.js';
import { setToken, clearToken, getToken } from '@/utils/request.js';
import { getCache, setCache } from '@/utils/common.js';

const state = Vue.observable({
  token: getToken(),
  user: uni.getStorageSync('yangci_user') || null,
  books: [],
  cards: [],
  loading: false,
});

const store = {
  state,

  async ensureLogin() {
    if (state.token) return true;
    state.loading = true;
    try {
      const res = await apiLogin();
      if (res.data && res.data.token) {
        setToken(res.data.token);
        state.token = res.data.token;
        state.user = res.data.user;
        uni.setStorageSync('yangci_user', res.data.user);
        return true;
      }
      return false;
    } finally {
      state.loading = false;
    }
  },

  logout() {
    clearToken();
    state.token = '';
    state.user = null;
    state.books = [];
    state.cards = [];
    uni.removeStorageSync('yangci_user');
  },

  async fetchBooks(force = false) {
    if (!force) {
      const cached = getCache('books');
      if (cached) state.books = cached;
    }
    const res = await getBookList();
    if (res.data) {
      state.books = res.data;
      setCache('books', res.data);
    }
    return state.books;
  },

  async fetchCards(force = false) {
    if (!force) {
      const cached = getCache('cards');
      if (cached) state.cards = cached;
    }
    const res = await getCardList();
    if (res.data) {
      state.cards = res.data;
      setCache('cards', res.data);
    }
    return state.cards;
  },
};

export default store;
