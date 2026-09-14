import Vue from 'vue';
import { login as apiLogin, silentWxLogin, register as apiRegister } from '@/api/auth.js';
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

const HOME = '/pages/index/index';
const LOGIN = '/pages/login/login';

const store = {
  state,

  /**
   * 确保已登录。
   * @param {Object} opts
   *  - noRedirect: true 时不跳登录页（登录/注册页自身调用，避免循环）
   *  - force: 强制请求一次登录（微信小程序首次静默登录用）
   * @returns {Promise<boolean>} 是否已登录
   */
  async ensureLogin(opts = {}) {
    const { noRedirect = false, force = false } = opts;
    // 已有 token（且非强制重登）直接通过
    if (state.token && !force) return true;

    // 微信小程序环境：仍走微信静默登录
    // #ifdef MP-WEIXIN
    try {
      const res = await silentWxLogin();
      if (res && res.data && res.data.token) {
        this.applyLogin(res.data);
        return true;
      }
    } catch (e) {
      // 微信登录失败落入下方跳登录页
    }
    // #endif

    if (noRedirect) return false;
    this.redirectToLogin();
    return false;
  },

  /** 登录（账号密码），成功后存状态并返回用户 */
  async loginAccount(username, password) {
    const res = await apiLogin({ username, password });
    if (res && res.data && res.data.token) {
      this.applyLogin(res.data);
      return { ok: true, user: res.data.user };
    }
    return { ok: false, msg: (res && res.msg) || '登录失败' };
  },

  /** 注册（账号密码），注册成功即自动登录 */
  async registerAccount(payload) {
    const res = await apiRegister(payload);
    if (res && res.data && res.data.token) {
      this.applyLogin(res.data);
      return { ok: true, user: res.data.user };
    }
    return { ok: false, msg: (res && res.msg) || '注册失败' };
  },

  /** 写入登录态 */
  applyLogin(data) {
    setToken(data.token);
    state.token = data.token;
    state.user = data.user;
    uni.setStorageSync('yangci_user', data.user);
  },

  /** 跳转登录页（带来源，登录后可返回） */
  redirectToLogin() {
    const pages = getCurrentPages();
    const current = pages.length ? `/${pages[pages.length - 1].route}` : HOME;
    // 防止已在登录/注册页时重复跳
    if (!/\/pages\/(login|register)\//.test(current)) {
      uni.reLaunch({ url: `${LOGIN}?redirect=${encodeURIComponent(current)}` });
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
