<template>
  <view class="page">
    <view class="brand">
      <view class="logo">🐥</view>
      <text class="brand-name">养词</text>
      <text class="brand-slogan">把背单词，变成养宠物</text>
    </view>

    <view class="card">
      <input
        class="field"
        v-model="username"
        placeholder="用户名"
        placeholder-class="ph"
        :maxlength="20"
      />
      <view class="divider" />
      <input
        class="field"
        v-model="password"
        placeholder="密码（至少 6 位）"
        placeholder-class="ph"
        password
        :maxlength="64"
        @confirm="doLogin"
      />

      <button class="submit-btn" :loading="loading" :disabled="loading" @click="doLogin">
        登 录
      </button>

      <view class="extra">
        <text class="link" @click="goRegister">还没有账号？去注册</text>
      </view>

      <!-- 微信小程序环境：展示微信快捷登录 -->
      <!-- #ifdef MP-WEIXIN -->
      <view class="wx-row">
        <view class="wx-line" />
        <text class="wx-tip">或</text>
        <view class="wx-line" />
      </view>
      <button class="wx-btn" @click="wxQuickLogin">微信一键登录</button>
      <!-- #endif -->
    </view>

    <text class="error" v-if="error">{{ error }}</text>
  </view>
</template>

<script>
import store from '@/store/index.js';
import { silentWxLogin } from '@/api/auth.js';

export default {
  data() {
    return {
      username: '',
      password: '',
      loading: false,
      error: '',
      redirect: '',
    };
  },
  onLoad(options) {
    this.redirect = (options && options.redirect) || '';
    // 已有登录态：直接回首页
    if (store.state.token) {
      this.goHome();
    }
  },
  methods: {
    validate() {
      const u = this.username.trim();
      const p = this.password;
      if (!u) { this.error = '请输入用户名'; return false; }
      if (!p) { this.error = '请输入密码'; return false; }
      return true;
    },
    async doLogin() {
      if (this.loading) return;
      this.error = '';
      if (!this.validate()) return;
      this.loading = true;
      try {
        const res = await store.loginAccount(this.username.trim(), this.password);
        if (res.ok) {
          uni.showToast({ title: '登录成功', icon: 'success' });
          setTimeout(() => this.goHome(), 400);
        } else {
          this.error = res.msg || '登录失败';
        }
      } catch (e) {
        this.error = (e && e.msg) || '网络异常，请稍后重试';
      } finally {
        this.loading = false;
      }
    },
    // 微信环境快捷登录
    async wxQuickLogin() {
      if (this.loading) return;
      this.error = '';
      this.loading = true;
      try {
        uni.showLoading({ title: '登录中...' });
        const res = await silentWxLogin();
        uni.hideLoading();
        if (res && res.data && res.data.token) {
          store.applyLogin(res.data);
          uni.showToast({ title: '登录成功', icon: 'success' });
          setTimeout(() => this.goHome(), 400);
        } else {
          this.error = (res && res.msg) || '微信登录失败';
        }
      } catch (e) {
        uni.hideLoading();
        this.error = (e && e.msg) || '微信登录失败';
      } finally {
        this.loading = false;
      }
    },
    goRegister() {
      uni.navigateTo({ url: '/pages/register/register' });
    },
    goHome() {
      if (this.redirect && this.redirect !== '/pages/login/login') {
        uni.reLaunch({ url: decodeURIComponent(this.redirect) });
        return;
      }
      uni.reLaunch({ url: '/pages/index/index' });
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: linear-gradient(180deg, #4a90e2 0%, #67b8ff 40%, #f0f2f5 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 60rpx;
  box-sizing: border-box;
}

.brand {
  margin-top: 140rpx;
  margin-bottom: 60rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.logo {
  font-size: 120rpx;
}

.brand-name {
  font-size: 64rpx;
  font-weight: bold;
  color: #fff;
  margin-top: 12rpx;
  letter-spacing: 8rpx;
  text-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.15);
}

.brand-slogan {
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 8rpx;
}

.card {
  width: 100%;
  background: #fff;
  border-radius: 28rpx;
  padding: 20rpx 40rpx 44rpx;
  box-shadow: 0 12rpx 40rpx rgba(0, 0, 0, 0.08);
}

.field {
  height: 96rpx;
  font-size: 30rpx;
  color: #333;
}

.divider {
  height: 1rpx;
  background: #f0f0f0;
}

.ph {
  color: #bbb;
}

.error {
  color: #e53935;
  font-size: 24rpx;
  margin-top: 24rpx;
  text-align: center;
}

.submit-btn {
  margin-top: 40rpx;
  background: linear-gradient(135deg, #4a90e2, #67b8ff);
  color: #fff;
  font-size: 32rpx;
  font-weight: bold;
  border-radius: 48rpx;
  height: 88rpx;
  line-height: 88rpx;
}

.submit-btn::after {
  border: none;
}

.submit-btn[disabled] {
  opacity: 0.7;
}

.extra {
  margin-top: 28rpx;
  display: flex;
  justify-content: center;
}

.link {
  color: #4a90e2;
  font-size: 26rpx;
}

.wx-row {
  margin-top: 40rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.wx-line {
  flex: 1;
  height: 1rpx;
  background: #eee;
}

.wx-tip {
  color: #aaa;
  font-size: 24rpx;
}

.wx-btn {
  margin-top: 24rpx;
  background: #07c160;
  color: #fff;
  border-radius: 48rpx;
  font-size: 30rpx;
}

.wx-btn::after {
  border: none;
}
</style>
