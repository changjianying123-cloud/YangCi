<template>
  <view class="page">
    <view class="head">
      <text class="head-title">创建账号</text>
      <text class="head-sub">注册后即可开始收服你的第一只单词</text>
    </view>

    <view class="card">
      <input
        class="field"
        v-model="username"
        placeholder="用户名（4-20位字母/数字/下划线）"
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
      />
      <view class="divider" />
      <input
        class="field"
        v-model="confirm"
        placeholder="确认密码"
        placeholder-class="ph"
        password
        :maxlength="64"
      />
      <view class="divider" />
      <input
        class="field"
        v-model="nickname"
        placeholder="昵称（可选，默认为用户名）"
        placeholder-class="ph"
        :maxlength="24"
      />

      <button class="submit-btn" :loading="loading" :disabled="loading" @click="doRegister">
        注 册
      </button>

      <view class="extra">
        <text class="link" @click="back">已有账号？去登录</text>
      </view>
    </view>

    <text class="error" v-if="error">{{ error }}</text>
  </view>
</template>

<script>
import store from '@/store/index.js';

export default {
  data() {
    return {
      username: '',
      password: '',
      confirm: '',
      nickname: '',
      loading: false,
      error: '',
    };
  },
  methods: {
    validate() {
      const u = this.username.trim();
      const p = this.password;
      const c = this.confirm;
      if (!u) { this.error = '请输入用户名'; return false; }
      if (!/^[a-zA-Z0-9_]{4,20}$/.test(u)) {
        this.error = '用户名需为 4-20 位字母、数字或下划线';
        return false;
      }
      if (!p) { this.error = '请输入密码'; return false; }
      if (p.length < 6) { this.error = '密码至少 6 位'; return false; }
      if (!c) { this.error = '请再次输入密码'; return false; }
      if (p !== c) { this.error = '两次输入的密码不一致'; return false; }
      return true;
    },
    async doRegister() {
      if (this.loading) return;
      this.error = '';
      if (!this.validate()) return;
      this.loading = true;
      try {
        const res = await store.registerAccount({
          username: this.username.trim(),
          password: this.password,
          nickname: this.nickname.trim() || undefined,
        });
        if (res.ok) {
          uni.showToast({ title: '注册成功！', icon: 'success' });
          setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 600);
        } else {
          this.error = res.msg || '注册失败';
        }
      } catch (e) {
        this.error = (e && e.msg) || '注册失败，请稍后再试';
      } finally {
        this.loading = false;
      }
    },
    back() {
      uni.navigateBack({
        fail: () => uni.reLaunch({ url: '/pages/login/login' }),
      });
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f7f8fa;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 60rpx;
  box-sizing: border-box;
}

.head {
  width: 100%;
  margin-top: 120rpx;
  margin-bottom: 48rpx;
}

.head-title {
  display: block;
  font-size: 52rpx;
  font-weight: bold;
  color: #222;
}

.head-sub {
  display: block;
  font-size: 26rpx;
  color: #999;
  margin-top: 12rpx;
}

.card {
  width: 100%;
  background: #fff;
  border-radius: 28rpx;
  padding: 20rpx 40rpx 44rpx;
  box-shadow: 0 12rpx 40rpx rgba(0, 0, 0, 0.06);
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

.error {
  color: #e53935;
  font-size: 24rpx;
  margin-top: 24rpx;
  text-align: center;
}
</style>
