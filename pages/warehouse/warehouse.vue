<template>
  <view class="container">
    <view class="header">
      <text class="title">我的单词仓库</text>
    </view>

    <view class="section-title">饥饿的单词 ({{ hungryWords.length }})</view>
    <transition-group name="card" tag="view" class="cards-container">
      <view 
        v-for="word in hungryWords" 
        :key="word.word_id" 
        class="flip-card"
        :class="{ 'pulse-animation': word.pulse }"
        @click="feedWord(word)"
      >
        <view class="flip-card-inner">
          <view class="flip-card-front" style="background-image: linear-gradient(135deg, #6e8efb, #a777e3);">
            <text class="word">{{ word.word }}</text>
            <text class="status">点击喂养</text>
          </view>
          <view class="flip-card-back">
            <text class="meaning">{{ word.meaning }}</text>
            <text class="next-review">下次复习: {{ formatNextReviewTime(word.next_review_time) }}</text>
          </view>
        </view>
      </view>
    </transition-group>

    <view class="section-title">健康的单词 ({{ healthyWords.length }})</view>
    <transition-group name="card" tag="view" class="cards-container">
      <view 
        v-for="word in healthyWords" 
        :key="word.word_id" 
        class="flip-card"
      >
        <view class="flip-card-inner">
          <view class="flip-card-front" style="background-image: linear-gradient(135deg, #56ab2f, #a8e063);">
            <text class="word">{{ word.word }}</text>
            <text class="status">健康</text>
          </view>
          <view class="flip-card-back">
            <text class="meaning">{{ word.meaning }}</text>
            <text class="next-review">下次复习: {{ formatNextReviewTime(word.next_review_time) }}</text>
          </view>
        </view>
      </view>
    </transition-group>
  </view>
</template>

<script>
import { request } from '@/utils/request.js';

export default {
  data() {
    return {
      wordList: [],
      now: Date.now()
    };
  },
  computed: {
    hungryWords() {
      return this.wordList.filter(w => w.next_review_time <= this.now);
    },
    healthyWords() {
      return this.wordList.filter(w => w.next_review_time > this.now);
    }
  },
  onShow() {
    this.fetchWords();
  },
  methods: {
    async fetchWords() {
      const res = await request('/word/feed');
      this.wordList = res.data || [];
      this.now = Date.now();
    },
    async feedWord(word) {
      if (word.next_review_time > this.now) {
        uni.showToast({ title: '单词还不饿哦~', icon: 'none' });
        return;
      }
      
      // 触发动画
      this.$set(word, 'pulse', true);
      setTimeout(() => { 
        this.$set(word, 'pulse', false);
        this.fetchWords(); 
      }, 500);

      await request('/word/feed', { method: 'POST', data: { word_id: word.word_id } });
    },
    formatNextReviewTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString();
    }
  }
};
</script>

<style scoped>
/* 你的原有样式可以保留，以下为新增样式 */
.container {
  padding-bottom: 200rpx;
}

.header {
  padding: 1.5rem 1rem;
  background-color: #f8f8f8;
  border-bottom: 1px solid #eee;
}

.title {
  font-size: 1.8em;
  font-weight: bold;
  color: #333;
}

.section-title {
  font-size: 1.2em;
  font-weight: bold;
  margin: 1.5rem 1rem 1rem;
  color: #333;
}

.word {
  font-size: 2em;
  font-weight: bold;
  color: white;
  text-shadow: 0 2px 4px rgba(0,0,0,0.5);
}

.status, .meaning {
  font-size: 1.2em;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 1rem;
}

.next-review {
  font-size: 0.9em;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 0.5rem;
}
</style>