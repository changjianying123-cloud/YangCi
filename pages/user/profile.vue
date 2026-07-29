<template>
  <view class="page">
    <view class="profile-hero">
      <button class="avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
        <image v-if="avatarUrl" class="avatar-img" :src="avatarUrl" mode="aspectFill" />
        <view v-else class="avatar">{{ avatarText }}</view>
      </button>
      <view class="info">
        <input
          class="nickname-input"
          type="nickname"
          :value="nickname"
          placeholder="点击设置昵称"
          @blur="onNicknameBlur"
          @input="onNicknameInput"
        />
        <text class="uid">ID: {{ user.id || '-' }}</text>
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
      <text class="section-title">近7日喂养</text>
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
import { getProfile, updateProfile } from '@/api/auth.js';
import AppTabBar from '@/components/AppTabBar/AppTabBar.vue';

export default {
  components: { AppTabBar },
  data() {
    return {
      user: {},
      stats: {},
      nickname: '',
      avatarUrl: '',
    };
  },
  computed: {
    avatarText() {
      return (this.nickname || '词').slice(0, 1);
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
      }
      const statRes = await getStatOverview();
      if (statRes.data) this.stats = statRes.data;
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
</style>
