<template>
  <view class="page">
    <view class="hero">
      <text class="title">我的单词图鉴</text>
      <view class="summary">
        <view class="summary-item">
          <text class="num">{{ cards.length }}</text>
          <text class="label">总卡牌</text>
        </view>
        <view class="summary-item warn">
          <text class="num">{{ pendingCount }}</text>
          <text class="label">待喂养</text>
        </view>
        <view class="summary-item">
          <text class="num">{{ normalCount }}</text>
          <text class="label">健康</text>
        </view>
      </view>
    </view>

    <view class="filter-bar">
      <text
        v-for="item in filters"
        :key="item.value"
        class="filter-item"
        :class="{ active: currentFilter === item.value }"
        @click="currentFilter = item.value"
      >{{ item.label }}</text>
    </view>

    <view v-if="loading" class="empty">
      <text class="loading-icon">⏳</text>
      <text>加载中...</text>
    </view>
    <view v-else-if="filteredCards.length === 0" class="empty">
      <text class="empty-icon">📭</text>
      <text>还没有卡牌，去收服单词吧！</text>
      <button class="primary-btn" @click="goSelectBook">去收服</button>
    </view>
    <view v-else class="card-grid">
      <WordCard
        v-for="card in filteredCards"
        :key="card.id"
        :card="card"
        @click="onCardClick"
      />
    </view>

    <AppTabBar current="/pages/index/index" />
  </view>
</template>

<script>
import store from '@/store/index.js';
import WordCard from '@/components/WordCard/WordCard.vue';
import AppTabBar from '@/components/AppTabBar/AppTabBar.vue';

export default {
  components: { WordCard, AppTabBar },
  data() {
    return {
      loading: false,
      currentFilter: 'all',
      filters: [
        { label: '全部', value: 'all' },
        { label: '待喂养', value: 'feed' },
        { label: '饥饿', value: 'hungry' },
        { label: '单词蛋', value: 'egg' },
      ],
    };
  },
  computed: {
    cards() {
      return store.state.cards;
    },
    pendingCount() {
      return this.cards.filter((c) => c.status === 'incubating' || c.status === 'hungry').length;
    },
    normalCount() {
      return this.cards.filter((c) => c.status === 'normal').length;
    },
    filteredCards() {
      if (this.currentFilter === 'all') return this.cards;
      if (this.currentFilter === 'feed') {
        return this.cards.filter((c) => c.status === 'incubating' || c.status === 'hungry');
      }
      return this.cards.filter((c) => { if (this.currentFilter === 'egg') return c.isEgg; return c.status === this.currentFilter; });
    },
  },
  async onShow() {
    await this.loadData();
  },
  onPullDownRefresh() {
    this.loadData().finally(() => uni.stopPullDownRefresh());
  },
  methods: {
    async loadData() {
      this.loading = true;
      await store.ensureLogin();
      await store.fetchCards(true);
      this.loading = false;
    },
    goSelectBook() {
      uni.reLaunch({ url: '/pages/book/select' });
    },
    onCardClick(card) {
      uni.navigateTo({ url: `/pages/word/feed?cardId=${card.id}` });
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f0f2f5;
  padding-bottom: calc(120rpx + env(safe-area-inset-bottom));
}

.hero {
  background: linear-gradient(135deg, #4a90e2 0%, #67b8ff 100%);
  padding: 80rpx 32rpx 40rpx;
  border-radius: 0 0 40rpx 40rpx;
}

.title {
  display: block;
  font-size: 40rpx;
  font-weight: bold;
  color: #fff;
  margin-bottom: 32rpx;
}

.summary {
  display: flex;
  flex-direction: row;
}

.summary-item {
  flex: 1;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 16rpx;
  padding: 24rpx 12rpx;
  text-align: center;
  margin-right: 16rpx;
}

.summary-item:last-child {
  margin-right: 0;
}

.summary-item.warn {
  background: rgba(255, 152, 0, 0.35);
}

.num {
  display: block;
  font-size: 40rpx;
  font-weight: bold;
  color: #fff;
}

.label {
  display: block;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 6rpx;
}

.filter-bar {
  display: flex;
  flex-direction: row;
  padding: 24rpx 24rpx 16rpx;
}

.filter-item {
  padding: 12rpx 28rpx;
  background: #fff;
  border-radius: 40rpx;
  font-size: 26rpx;
  color: #666;
  margin-right: 16rpx;
  white-space: nowrap;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}

.filter-item.active {
  background: #4a90e2;
  color: #fff;
}

/* 改用 flex 实现两列（微信小程序不支持 grid） */
.card-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  padding: 0 20rpx 20rpx;
}

.card-grid > .word-card {
  width: calc(50% - 14rpx);
  margin-bottom: 20rpx;
}

.card-grid > .word-card:nth-child(odd) {
  margin-right: 14rpx;
}

.empty {
  text-align: center;
  padding: 120rpx 40rpx;
  color: #999;
  font-size: 28rpx;
}

.empty-icon,
.loading-icon {
  display: block;
  font-size: 80rpx;
  margin-bottom: 16rpx;
}

.primary-btn {
  margin-top: 32rpx;
  background: #4a90e2;
  color: #fff;
  border-radius: 40rpx;
  width: 280rpx;
}
</style>
