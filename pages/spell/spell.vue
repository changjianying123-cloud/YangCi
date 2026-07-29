<template>
  <view class="page-container">
    <!-- 顶部状态 -->
    <view class="top-bar">
      <text class="domain-name">{{ domainName }} 探索中</text>
      <text class="progress">✅ 正确次数: {{ correctCount }} / 3</text>
    </view>

    <!-- 单词展示区 -->
    <view class="word-card">
      <text class="word-meaning">{{ currentWord.meaning || '加载中...' }}</text>
      <text class="word-hint" v-if="currentWord.word">
        (提示: {{ currentWord.word[0] }}*** 共{{ currentWord.word.length }}个字母)
      </text>
    </view>

    <!-- 输入区 -->
    <view class="input-area">
      <input 
        class="spell-input" 
        v-model="inputValue" 
        placeholder="请输入单词拼写..." 
        :disabled="isCapturing"
        confirm-type="done"
        @confirm="checkSpell"
      />
      <button class="submit-btn" @click="checkSpell" :disabled="isCapturing">
        {{ isCapturing ? '捕获中...' : '确认拼写' }}
      </button>
    </view>

    <!-- 成功入仓弹窗/动画 -->
    <view class="success-mask" v-if="isCapturing">
      <view class="success-box">
        <text class="success-icon">🎉</text>
        <text class="success-text">连续3次正确！</text>
        <text class="success-sub">单词已加入仓库，快去喂养吧！</text>
        <button class="go-feed-btn" @click="goToWarehouse">前往仓库喂养</button>
      </view>
    </view>
  </view>
</template>

<script>
import { request } from '@/utils/request.js';

export default {
  data() {
    return {
      domain: '',
      domainName: '',
      currentWord: {},
      inputValue: '',
      correctCount: 0,
      isCapturing: false
    };
  },
  onLoad(options) {
    this.domain = options.domain;
    this.domainName = options.name;
    this.fetchWord();
  },
  methods: {
    // 1. 获取随机单词
    async fetchWord() {
      const res = await request(`/word/random?domain=${this.domain}`);
      if (res.data) {
        this.currentWord = res.data;
        this.inputValue = '';
      } else {
        uni.showToast({ title: '该领域暂无单词', icon: 'none' });
      }
    },
    // 2. 校验拼写
    checkSpell() {
      if (!this.inputValue.trim()) return;
      
      if (this.inputValue.toLowerCase() === this.currentWord.word.toLowerCase()) {
        this.correctCount++;
        uni.showToast({ title: `正确！(${this.correctCount}/3)`, icon: 'none' });
        
        // 满3次，触发入仓
        if (this.correctCount >= 3) {
          this.captureWord();
        } else {
          // 正确但未满3次，清空输入框让用户继续
          this.inputValue = ''; 
        }
      } else {
        uni.showToast({ title: '拼写错误，再试一次', icon: 'none' });
        this.inputValue = ''; // 错误也清空，重新输入
      }
    },
    // 3. 调用后端接口入仓
    async captureWord() {
      this.isCapturing = true;
      await request('/word/capture', {
        method: 'POST',
        data: { word_id: this.currentWord.id }
      });
    },
    // 4. 跳转到仓库
    goToWarehouse() {
      uni.navigateTo({ url: '/pages/warehouse/warehouse' });
    }
  }
};
</script>

<style scoped>
.page-container { padding: 30rpx; background: #F9F9F9; min-height: 100vh; }
.top-bar { display: flex; justify-content: space-between; margin-bottom: 40rpx; }
.domain-name { font-size: 32rpx; font-weight: bold; color: #333; }
.progress { font-size: 26rpx; color: #4A90E2; font-weight: bold; }

.word-card { background: #fff; padding: 60rpx; border-radius: 20rpx; text-align: center; margin-bottom: 40rpx; box-shadow: 0 4rpx 12rpx rgba(0,0,0,0.05); }
.word-meaning { font-size: 40rpx; color: #333; font-weight: bold; display: block; margin-bottom: 20rpx; }
.word-hint { font-size: 24rpx; color: #999; }

.input-area { display: flex; align-items: center; gap: 20rpx; }
.spell-input { flex: 1; background: #fff; padding: 20rpx; border-radius: 12rpx; font-size: 30rpx; }
.submit-btn { background: #4A90E2; color: #fff; font-size: 28rpx; padding: 0 30rpx; border-radius: 12rpx; height: 80rpx; line-height: 80rpx; }

.success-mask { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 999; }
.success-box { background: #fff; padding: 60rpx; border-radius: 20rpx; text-align: center; width: 500rpx; }
.success-icon { font-size: 80rpx; display: block; margin-bottom: 20rpx; }
.success-text { font-size: 36rpx; font-weight: bold; display: block; margin-bottom: 10rpx; }
.success-sub { font-size: 24rpx; color: #999; display: block; margin-bottom: 40rpx; }
.go-feed-btn { background: #FF9500; color: #fff; border-radius: 40rpx; font-size: 30rpx; }
</style>