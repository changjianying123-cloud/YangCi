<template>
  <view class="page">
    <view class="profile-hero">
      <button class="avatar-btn" v-if="!avatarUrl" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
        <view class="avatar">{{ avatarText }}</view>
      </button>
      <image v-else class="avatar-img" :src="avatarUrl" mode="aspectFill" />
      <view class="info">
        <input class="nickname-input" :value="nickname" placeholder="输入昵称" @input="onNicknameInput" @blur="onNicknameBlur" />
        <text class="uid">UID: {{ user.openid || '--' }}</text>
      </view>
    </view>

    <view class="coin-section">
      <view class="coin-icon">💰</view>
      <text class="coin-num">{{ stats.coins || 0 }}</text>
      <text class="coin-label">金币</text>
    </view>

    <view class="section logout-section">
      <text class="logout-btn" @click="confirmLogout">退出登录</text>
    </view>

    <!-- 重复拼写次数设置 -->
    <view class="section">
      <text class="section-title">练习强度</text>
      <text class="section-sub">觉得重复太多或太少？可自定义（默认：收服 {{ repeat.defaultCatchRepeat }} 次 / 喂养 {{ repeat.defaultFeedRepeat }} 次）</text>

      <view class="stepper-row">
        <view class="stepper-label">
          <text class="stepper-name">收服单词</text>
          <text class="stepper-desc">拼对几次才算收服</text>
        </view>
        <view class="stepper">
          <text class="stepper-btn" :class="{ disabled: catchRepeat <= repeat.catchMin }" @click="stepCatch(-1)">−</text>
          <text class="stepper-value">{{ catchRepeat }}</text>
          <text class="stepper-btn" :class="{ disabled: catchRepeat >= repeat.catchMax }" @click="stepCatch(1)">＋</text>
        </view>
      </view>

      <view class="stepper-row">
        <view class="stepper-label">
          <text class="stepper-name">喂养单词</text>
          <text class="stepper-desc">拼对几次才算喂一次</text>
        </view>
        <view class="stepper">
          <text class="stepper-btn" :class="{ disabled: feedRepeat <= repeat.feedMin }" @click="stepFeed(-1)">−</text>
          <text class="stepper-value">{{ feedRepeat }}</text>
          <text class="stepper-btn" :class="{ disabled: feedRepeat >= repeat.feedMax }" @click="stepFeed(1)">＋</text>
        </view>
      </view>

      <view class="reset-row">
        <text class="reset-btn" @click="resetRepeat">恢复默认</text>
        <text class="reset-tip" v-if="isRepeatDefault">当前已是默认</text>
      </view>
    </view>

    <view class="stats-grid">
      <view class="stat-item">
        <text class="stat-num">{{ stats.totalCards || 0 }}</text>
        <text class="stat-label">总卡牌</text>
      </view>
      <view class="stat-item">
        <text class="stat-num">{{ stats.totalFeeds || 0 }}</text>
        <text class="stat-label">喂养次数</text>
      </view>
      <view class="stat-item highlight">
        <text class="stat-num">{{ stats.hungryCount || 0 }}</text>
        <text class="stat-label">待喂养</text>
      </view>
      <view class="stat-item">
        <text class="stat-num">{{ stats.runawayCount || 0 }}</text>
        <text class="stat-label">跑路</text>
      </view>
    </view>

    <view class="section">
      <text class="section-title">词书进度</text>
      <view v-for="item in stats.bookProgress || []" :key="item.bookCode" class="progress-row">
        <text>{{ item.bookName }}</text>
        <view class="progress-right">
          <view class="mini-bar">
            <view class="mini-fill" :style="{ width: bookPercent(item) + '%' }" />
          </view>
          <text class="progress-num">{{ item.caughtCount }}</text>
        </view>
      </view>
    </view>

    <view class="section">
      <text class="section-title">每日喂养</text>
      <view v-if="(stats.recentFeeds || []).length === 0" class="empty-tip">暂无记录</view>
      <view v-else class="chart">
        <view v-for="item in stats.recentFeeds" :key="item.day" class="chart-bar-wrap">
          <view class="chart-bar" :style="{ height: barHeight(item.count) + 'rpx' }" />
          <text class="chart-label">{{ formatDay(item.day) }}</text>
        </view>
      </view>
    </view>

    <AppTabBar current="/pages/user/profile" />
  </view>
</template>

<script>
import store from '@/store/index.js';
import { getStatOverview } from '@/api/stat.js';
import { getProfile, updateProfile, updateRepeatSettings } from '@/api/auth.js';
import AppTabBar from '@/components/AppTabBar/AppTabBar.vue';

export default {
  components: { AppTabBar },
  data() {
    return {
      user: {},
      stats: {},
      nickname: '',
      avatarUrl: '',
      repeat: { catchRepeat: 6, feedRepeat: 3, defaultCatchRepeat: 6, defaultFeedRepeat: 3, catchMin: 1, catchMax: 20, feedMin: 1, feedMax: 10 },
    };
  },
  computed: {
    avatarText() {
      return (this.nickname || '?').slice(0, 1);
    },
    catchRepeat() {
      return Number(this.repeat.catchRepeat) || this.repeat.defaultCatchRepeat;
    },
    feedRepeat() {
      return Number(this.repeat.feedRepeat) || this.repeat.defaultFeedRepeat;
    },
    isRepeatDefault() {
      return (
        this.catchRepeat === this.repeat.defaultCatchRepeat &&
        this.feedRepeat === this.repeat.defaultFeedRepeat
      );
    },
    maxFeedCount() {
      const feeds = this.stats.recentFeeds || [];
      return Math.max(...feeds.map((f) => f.count), 1);
    },
  },
  async onShow() {
    await store.ensureLogin();
    await this.loadData();
  },
  methods: {
    async loadData() {
      const profileRes = await getProfile();
      if (profileRes.data) {
        this.user = profileRes.data;
        this.nickname = profileRes.data.nickname || '';
        this.avatarUrl = profileRes.data.avatar_url || '';
        if (profileRes.data.repeat) this.repeat = profileRes.data.repeat;
      }
      const statRes = await getStatOverview();
      if (statRes.data) this.stats = statRes.data;
    },
    logout() {
      store.logout();
      uni.reLaunch({ url: '/pages/login/login' });
    },
    confirmLogout() {
      uni.showModal({
        title: '退出登录',
        content: '确定要退出当前账号吗？',
        success: (res) => {
          if (res.confirm) this.logout();
        },
      });
    },
    bookPercent(item) {
      const books = store.state.books;
      const book = books.find((b) => b.bookCode === item.bookCode);
      if (!book || !book.totalWords) return 0;
      return Math.min(100, Math.round((item.caughtCount / book.totalWords) * 100));
    },
    barHeight(count) {
      return Math.max(16, Math.round((count / this.maxFeedCount) * 120));
    },
    formatDay(day) {
      if (!day) return '';
      const d = new Date(day);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    },
    onNicknameInput(e) {
      this.nickname = e.detail.value;
    },
    async onNicknameBlur() {
      await this.saveProfile();
    },
    async onChooseAvatar(e) {
      this.avatarUrl = e.detail.avatarUrl;
      await this.saveProfile();
    },
    async saveProfile() {
      if (!this.nickname && !this.avatarUrl) return;
      const res = await updateProfile({
        nickname: this.nickname,
        avatar_url: this.avatarUrl,
      });
      if (res.data) {
        this.user = res.data;
        store.state.user = res.data;
        uni.setStorageSync('yangci_user', res.data);
      }
    },
    // ── 重复拼写次数 ──
    stepCatch(delta) {
      const next = Math.min(
        this.repeat.catchMax,
        Math.max(this.repeat.catchMin, this.catchRepeat + delta)
      );
      if (next === this.catchRepeat) return;
      this.repeat = { ...this.repeat, catchRepeat: next };
      this.saveRepeat({ catchRepeat: next });
    },
    stepFeed(delta) {
      const next = Math.min(
        this.repeat.feedMax,
        Math.max(this.repeat.feedMin, this.feedRepeat + delta)
      );
      if (next === this.feedRepeat) return;
      this.repeat = { ...this.repeat, feedRepeat: next };
      this.saveRepeat({ feedRepeat: next });
    },
    async saveRepeat(patch) {
      try {
        const res = await updateRepeatSettings(patch);
        if (res.data) this.repeat = res.data;
      } catch (e) {
        // 保存失败回滚到服务端设置
        await this.reloadRepeat();
      }
    },
    async reloadRepeat() {
      const profileRes = await getProfile();
      if (profileRes.data && profileRes.data.repeat) this.repeat = profileRes.data.repeat;
    },
    resetRepeat() {
      if (this.isRepeatDefault) return;
      uni.showModal({
        title: '恢复默认',
        content: `收服恢复为 ${this.repeat.defaultCatchRepeat} 次、喂养恢复为 ${this.repeat.defaultFeedRepeat} 次？`,
        success: (r) => {
          if (r.confirm) this.saveRepeat({ catchRepeat: null, feedRepeat: null });
        },
      });
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f0f2f5;
  padding-bottom: 24rpx;
}

.profile-hero {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, #4a90e2 0%, #67b8ff 100%);
  padding: 48rpx 32rpx;
  margin-bottom: 24rpx;
}

.avatar-btn {
  padding: 0;
  margin: 0;
  background: transparent;
  border: none;
  line-height: 1;
}

.avatar-btn::after {
  border: none;
}

.avatar,
.avatar-img {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  margin-right: 24rpx;
}

.avatar {
  background: rgba(255, 255, 255, 0.3);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.6);
}

.avatar-img {
  border: 4rpx solid rgba(255, 255, 255, 0.6);
}

.info {
  flex: 1;
}

.nickname-input {
  font-size: 36rpx;
  font-weight: bold;
  color: #fff;
  background: transparent;
}

.uid {
  display: block;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 8rpx;
}

.coin-section {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 32rpx;
  margin: 0 24rpx 24rpx;
  background: linear-gradient(135deg, #fff8e1, #ffecb3);
  border-radius: 24rpx;
}

.coin-icon {
  font-size: 64rpx;
  margin-bottom: 8rpx;
}

.coin-num {
  font-size: 52rpx;
  font-weight: bold;
  color: #e65100;
}

.coin-label {
  font-size: 26rpx;
  color: #a1887f;
  margin-top: 4rpx;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16rpx;
  padding: 0 24rpx;
  margin-bottom: 24rpx;
}

.stat-item {
  background: #fff;
  border-radius: 16rpx;
  padding: 28rpx;
  text-align: center;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
}

.stat-item.highlight {
  background: linear-gradient(135deg, #fff8e1, #fff);
}

.stat-num {
  display: block;
  font-size: 40rpx;
  font-weight: bold;
  color: #4a90e2;
}

.stat-label {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-top: 8rpx;
}

.section {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin: 0 24rpx 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
}

.logout-section {
  display: flex;
  justify-content: center;
}

.logout-btn {
  color: #e53935;
  font-size: 28rpx;
  padding: 12rpx 60rpx;
}

.section-title {
  display: block;
  font-size: 28rpx;
  font-weight: bold;
  margin-bottom: 16rpx;
}

.progress-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
  font-size: 26rpx;
}

.progress-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.mini-bar {
  width: 120rpx;
  height: 8rpx;
  background: #eee;
  border-radius: 4rpx;
  overflow: hidden;
}

.mini-fill {
  height: 100%;
  background: #4a90e2;
  border-radius: 4rpx;
}

.progress-num {
  color: #4a90e2;
  min-width: 40rpx;
  text-align: right;
}

.empty-tip {
  color: #999;
  font-size: 24rpx;
  padding: 16rpx 0;
}

.chart {
  display: flex;
  justify-content: space-around;
  align-items: flex-end;
  height: 160rpx;
  padding-top: 16rpx;
}

.chart-bar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.chart-bar {
  width: 32rpx;
  background: linear-gradient(180deg, #4a90e2, #67b8ff);
  border-radius: 8rpx 8rpx 0 0;
  min-height: 16rpx;
}

.chart-label {
  font-size: 20rpx;
  color: #999;
  margin-top: 8rpx;
}

/* ── 练习强度设置 ── */
.section-sub {
  display: block;
  font-size: 22rpx;
  color: #999;
  line-height: 1.6;
  margin-bottom: 20rpx;
}

.stepper-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}

.stepper-label {
  display: flex;
  flex-direction: column;
}

.stepper-name {
  font-size: 28rpx;
  color: #333;
}

.stepper-desc {
  font-size: 22rpx;
  color: #999;
  margin-top: 4rpx;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.stepper-btn {
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  background: #f0f4ff;
  color: #4a90e2;
  font-size: 32rpx;
  font-weight: bold;
}

.stepper-btn.disabled {
  background: #f5f5f5;
  color: #ccc;
}

.stepper-value {
  min-width: 72rpx;
  text-align: center;
  font-size: 32rpx;
  font-weight: bold;
  color: #4a90e2;
}

.reset-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 16rpx;
  padding-top: 20rpx;
}

.reset-btn {
  font-size: 24rpx;
  color: #4a90e2;
  padding: 8rpx 24rpx;
  border: 1rpx solid #4a90e2;
  border-radius: 24rpx;
}

.reset-tip {
  font-size: 22rpx;
  color: #bbb;
}
</style>
