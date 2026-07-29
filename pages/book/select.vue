<template>
  <view class="page">
    <view class="hero">
      <text class="page-title">选择学段词书</text>
      <text class="page-desc">连续拼对 3 次即可收服单词</text>
    </view>

    <view class="book-list">
      <view
        v-for="(book, index) in books"
        :key="book.bookCode"
        class="book-item"
        :style="{ animationDelay: index * 0.08 + 's' }"
        @click="enterBook(book)"
      >
        <view class="book-cover" :style="{ background: getGradient(book.bookCode) }">
          <text class="book-icon">{{ book.icon }}</text>
        </view>
        <view class="book-info">
          <text class="book-name">{{ book.bookName }}</text>
          <view class="progress-bar">
            <view class="progress-fill" :style="{ width: progressPercent(book) + '%', background: book.color }" />
          </view>
          <text class="book-progress">已收服 {{ book.caughtCount }} / {{ book.totalWords }}</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>

    <AppTabBar current="/pages/book/select" />
  </view>
</template>

<script>
import store from '@/store/index.js';
import AppTabBar from '@/components/AppTabBar/AppTabBar.vue';
import { getBookGradient } from '@/utils/theme.js';

export default {
  components: { AppTabBar },
  computed: {
    books() {
      return store.state.books;
    },
  },
  async onShow() {
    await store.ensureLogin();
    await store.fetchBooks(true);
  },
  methods: {
    getGradient(code) {
      return getBookGradient(code);
    },
    progressPercent(book) {
      if (!book.totalWords) return 0;
      return Math.min(100, Math.round((book.caughtCount / book.totalWords) * 100));
    },
    enterBook(book) {
      uni.navigateTo({
        url: `/pages/word/catch?bookCode=${book.bookCode}&bookName=${encodeURIComponent(book.bookName)}`,
      });
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f0f2f5;
}

.hero {
  padding: 40rpx 32rpx 16rpx;
}

.page-title {
  display: block;
  font-size: 40rpx;
  font-weight: bold;
  color: #222;
}

.page-desc {
  display: block;
  font-size: 26rpx;
  color: #999;
  margin-top: 8rpx;
}

.book-list {
  padding: 16rpx 24rpx;
}

.book-item {
  display: flex;
  align-items: center;
  background: #fff;
  padding: 24rpx;
  border-radius: 20rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.06);
  animation: slideIn 0.4s ease-out both;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(-20rpx); }
  to { opacity: 1; transform: translateX(0); }
}

.book-cover {
  width: 96rpx;
  height: 96rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 24rpx;
  flex-shrink: 0;
}

.book-icon {
  font-size: 44rpx;
}

.book-info {
  flex: 1;
  min-width: 0;
}

.book-name {
  display: block;
  font-size: 32rpx;
  font-weight: bold;
  color: #222;
}

.progress-bar {
  height: 8rpx;
  background: #eee;
  border-radius: 4rpx;
  margin: 12rpx 0 8rpx;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 4rpx;
  transition: width 0.5s ease;
}

.book-progress {
  font-size: 22rpx;
  color: #999;
}

.arrow {
  font-size: 40rpx;
  color: #ccc;
  margin-left: 12rpx;
}
</style>
