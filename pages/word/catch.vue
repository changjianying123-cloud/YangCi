<template>
  <view class="page">
    <view class="top-bar">
      <text class="book-name">{{ bookName }} · 收服练习</text>
      <text class="progress">正确 {{ correctCount }} / 6</text>
    </view>

    <view class="word-panel" v-if="currentWord.word">
      <text class="meaning">{{ currentWord.meaning }}</text>
      <text class="phonetic" v-if="currentWord.phonetic">{{ currentWord.phonetic }}</text>
      <AudioPlayer :src="currentWord.audioUrl" label="听发音" />
      <text class="hint" @click="showFullWord = !showFullWord">
        {{ showFullWord ? currentWord.word : '👆 点击显示完整单词' }}
      </text>
    </view>

    <SpellInput
      v-model="inputValue"
      :disabled="capturing"
      button-text="确认拼写"
      @submit="checkSpell"
    />

    <view class="success-mask" v-if="capturing">
      <view class="success-box">
        <text class="success-icon">🎉</text>
        <text class="success-text">收服成功！</text>
        <text class="success-sub">单词已加入你的图鉴</text>
        <button class="primary-btn" @click="goHome">查看图鉴</button>
        <button class="ghost-btn" @click="continueCatch">继续收服</button>
      </view>
    </view>
  </view>
</template>

<script>
import { getRandomWord, catchWord } from '@/api/word.js';
import SpellInput from '@/components/SpellInput/SpellInput.vue';
import AudioPlayer from '@/components/AudioPlayer/AudioPlayer.vue';
import store from '@/store/index.js';

export default {
  components: { SpellInput, AudioPlayer },
  data() {
    return {
      bookCode: '',
      bookName: '',
      currentWord: {},
      inputValue: '',
      correctCount: 0,
      capturing: false,
      showFullWord: false,
    };
  },
  computed: {
    hintText() {
      const w = this.currentWord.word || '';
      if (!w) return '';
      return `${w[0]}${'*'.repeat(Math.max(w.length - 1, 0))}（共 ${w.length} 个字母）`;
    },
  },
  onLoad(options) {
    this.bookCode = options.bookCode || '';
    this.bookName = decodeURIComponent(options.bookName || '');
    this.fetchWord();
  },
  methods: {
    async fetchWord() {
      const res = await getRandomWord(this.bookCode);
      if (res.data) {
        this.currentWord = res.data;
        this.inputValue = '';
      } else {
        uni.showToast({ title: res.msg || '暂无可收服单词', icon: 'none' });
      }
    },
    checkSpell() {
      if (!this.inputValue.trim() || this.capturing) return;
      const ok = this.inputValue.trim().toLowerCase() === (this.currentWord.word || '').toLowerCase();
      if (ok) {
        this.correctCount += 1;
        uni.showToast({ title: `正确 (${this.correctCount}/6)`, icon: 'none' });
        if (this.correctCount >= 6) {
          this.doCapture();
        } else {
          this.inputValue = '';
        }
      } else {
        uni.showToast({ title: '拼写错误', icon: 'none' });
        this.inputValue = '';
      }
    },
    async doCapture() {
      this.capturing = true;
      await catchWord(this.currentWord.id, 6);
      await store.fetchCards(true);
    },
    goHome() {
      uni.switchTab ? uni.switchTab({ url: '/pages/index/index' }) : uni.reLaunch({ url: '/pages/index/index' });
    },
    continueCatch() {
      this.capturing = false;
      this.correctCount = 0;
      this.fetchWord();
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f7f8fa;
  padding: 30rpx;
}

.top-bar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 40rpx;
}

.book-name {
  font-size: 30rpx;
  font-weight: bold;
}

.progress {
  font-size: 26rpx;
  color: #4a90e2;
}

.word-panel {
  background: #fff;
  border-radius: 20rpx;
  padding: 48rpx 32rpx;
  text-align: center;
  margin-bottom: 40rpx;
}

.meaning {
  display: block;
  font-size: 40rpx;
  font-weight: bold;
  margin-bottom: 16rpx;
}

.phonetic {
  display: block;
  font-size: 26rpx;
  color: #999;
  margin-bottom: 24rpx;
}

.hint {
  display: block;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: #999;
}

.success-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
}

.success-box {
  width: 560rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 48rpx;
  text-align: center;
}

.success-icon {
  font-size: 80rpx;
  display: block;
}

.success-text {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  margin: 16rpx 0;
}

.success-sub {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 32rpx;
}

.primary-btn {
  background: #4a90e2;
  color: #fff;
  border-radius: 40rpx;
  margin-bottom: 16rpx;
}

.ghost-btn {
  background: #f5f5f5;
  color: #666;
  border-radius: 40rpx;
}
</style>
