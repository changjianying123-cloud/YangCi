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
        <view class="summary-item coin">
          <text class="num">💰 {{ coins }}</text>
          <text class="label">金币</text>
        </view>
      </view>
      <button class="battle-btn" @click="goBattle">⚔️ 单词对战</button>
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
      <view
        v-for="card in filteredCards"
        :key="card.id"
        class="grid-item"
        @click="onCardClick(card)"
      >
        <WordCard :card="card" />
      </view>
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
      coins: 0,
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
      try {
        await store.ensureLogin();
        await store.fetchCards(true);
        // 从卡牌列表获取金币（第一张卡带coins字段）
        if (store.state.cards.length > 0 && store.state.cards[0].coins !== undefined) {
          this.coins = store.state.cards[0].coins;
        }
      } catch (e) {
        console.error('loadData err:', e);
        uni.showToast({ title: '加载失败，请重试', icon: 'none' });
      } finally {
        this.loading = false;
      }
    },
    goSelectBook() {
      uni.reLaunch({ url: '/pages/book/select' });
    },
    goBattle() {
      uni.navigateTo({ url: '/pages/battle/battle' });
    },
    onCardClick(card) {
      // 单词蛋直接孵蛋，没有「玩耍」概念
      if (card.isEgg) {
        uni.navigateTo({ url: `/pages/word/feed?cardId=${card.id}` });
        return;
      }
      // 🍼 饥饿 / 降级中的卡不能玩耍，只能去喂养（或花金币恢复）
      if (card.canPlay === false) {
        uni.showToast({ title: '单词饿啦，先喂养才能玩耍 🍼', icon: 'none' });
        uni.navigateTo({ url: `/pages/word/feed?cardId=${card.id}` });
        return;
      }
      // 点卡片 → 选「喂养」或「玩耍」（两者都算复习）
      uni.showActionSheet({
        itemList: ['🍼 喂养（拼写复习）', '🎈 玩耍（提升心情）'],
        success: (res) => {
          if (res.tapIndex === 1) {
            // 玩耍是二级菜单：选词四选一 / 英译汉
            this.choosePlayMode(card);
          } else {
            uni.navigateTo({ url: `/pages/word/feed?cardId=${card.id}` });
          }
        },
        fail: () => { /* 用户取消，不做任何事 */ },
      });
    },
    // 玩耍的两种玩法（都提升心情）
    choosePlayMode(card) {
      uni.showActionSheet({
        itemList: ['📝 选词四选一（看英文选中文）', '✍️ 英译汉（看英文打中文）'],
        success: (res) => {
          const mode = res.tapIndex === 1 ? 'translate' : 'pick';
          uni.navigateTo({ url: `/pages/word/play?cardId=${card.id}&mode=${mode}` });
        },
        fail: () => { /* 用户取消 */ },
      });
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
  gap: 16rpx;
}

.summary-item {
  flex: 1;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 16rpx;
  padding: 20rpx;
  text-align: center;
}

.summary-item.warn {
  background: rgba(255, 152, 0, 0.35);
}

.summary-item.coin {
  background: rgba(255, 215, 0, 0.35);
}

.battle-btn {
  margin-top: 28rpx;
  background: #ffd54f;
  color: #5d4037;
  font-size: 30rpx;
  font-weight: bold;
  border-radius: 40rpx;
  width: 360rpx;
  padding: 8rpx 0;
}

.num {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  color: #fff;
}

.label {
  display: block;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 4rpx;
}

.filter-bar {
  display: flex;
  padding: 16rpx 24rpx;
  gap: 16rpx;
}

.filter-item {
  font-size: 26rpx;
  color: #999;
  padding: 8rpx 20rpx;
  border-radius: 24rpx;
  background: #fff;
}

.filter-item.active {
  color: #4a90e2;
  background: rgba(74, 144, 226, 0.12);
  font-weight: bold;
}

.empty {
  text-align: center;
  padding: 120rpx 24rpx;
}

.loading-icon {
  font-size: 48rpx;
  display: block;
  margin-bottom: 16rpx;
}

.empty-icon {
  font-size: 80rpx;
  display: block;
  margin-bottom: 16rpx;
}

.primary-btn {
  background: #4a90e2;
  color: #fff;
  border-radius: 40rpx;
  margin-top: 32rpx;
  width: 300rpx;
}

.card-grid {
  display: flex;
  flex-wrap: wrap;
  padding: 0 16rpx 24rpx;
}

.grid-item {
  width: 50%;
  box-sizing: border-box;
  padding: 8rpx;
}
</style>
