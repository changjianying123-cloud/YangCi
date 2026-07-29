<template>
  <view class="tab-bar-root">
    <view class="tab-bar-placeholder" />
    <view class="tab-bar">
    <view
      v-for="tab in tabs"
      :key="tab.path"
      class="tab-item"
      :class="{ active: currentPath === tab.path }"
      @click="switchTab(tab.path)"
    >
      <view class="icon-wrap">
        <text class="icon">{{ tab.icon }}</text>
        <view v-if="tab.badge > 0" class="badge">{{ tab.badge > 99 ? '99+' : tab.badge }}</view>
      </view>
      <text class="label">{{ tab.label }}</text>
    </view>
    </view>
  </view>
</template>

<script>
import store from '@/store/index.js';

const TAB_PAGES = [
  { path: '/pages/index/index', icon: '📇', label: '图鉴' },
  { path: '/pages/book/select', icon: '⚔️', label: '收服' },
  { path: '/pages/user/profile', icon: '👤', label: '我的' },
];

export default {
  name: 'AppTabBar',
  props: {
    current: { type: String, default: '' },
  },
  computed: {
    currentPath() {
      if (this.current) return this.current;
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      return page ? `/${page.route}` : '/pages/index/index';
    },
    pendingCount() {
      return store.state.cards.filter(
        (c) => c.status === 'incubating' || c.status === 'hungry'
      ).length;
    },
    tabs() {
      return TAB_PAGES.map((tab) => ({
        ...tab,
        badge: tab.path === '/pages/index/index' ? this.pendingCount : 0,
      }));
    },
  },
  methods: {
    switchTab(path) {
      if (path === this.currentPath) return;
      uni.reLaunch({ url: path });
    },
  },
};
</script>

<style scoped>
.tab-bar-placeholder {
  height: calc(100rpx + env(safe-area-inset-bottom));
}

.tab-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  background: #fff;
  border-top: 1rpx solid #eee;
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 999;
  box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, 0.04);
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12rpx 0 8rpx;
}

.tab-item.active .label {
  color: #4a90e2;
  font-weight: bold;
}

.icon-wrap {
  position: relative;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon {
  font-size: 40rpx;
  line-height: 1;
}

.badge {
  position: absolute;
  top: -8rpx;
  right: -20rpx;
  min-width: 32rpx;
  height: 32rpx;
  line-height: 32rpx;
  padding: 0 8rpx;
  background: #f44336;
  color: #fff;
  font-size: 20rpx;
  border-radius: 16rpx;
  text-align: center;
}

.label {
  font-size: 22rpx;
  color: #999;
  margin-top: 4rpx;
}
</style>
