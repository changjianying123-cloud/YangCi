<template>
  <view class="page">
    <view class="top-bar">
      <view class="top-bar-left">
        <text class="book-name">{{ bookName }} · 收服练习</text>
        <text class="refresh-btn" @click="doRefresh">🔄 换一个</text>
      </view>
      <view class="progress-area">
        <text class="progress">已收集 {{ reviewPool.length }}/10</text>
        <text v-if="reviewPool.length >= 10" class="bonus">+20💰</text>
      </view>
    </view>

    <!-- 当前阶段提示 -->
    <view class="stage-hint">
      <view class="stage-tag" v-if="phase === 'spelling'">
        <text>✏️ 拼写收服 · {{ correctCount }}/6</text>
      </view>
      <view class="stage-tag review-stage" v-else-if="phase === 'review'">
        <text>🔄 滚动检测 · {{ reviewIndex + 1 }} / {{ reviewPool.length }}</text>
      </view>
      <view class="stage-tag fail-stage" v-else-if="phase === 'failBack'">
        <text>😅 补考 · 重新拼写 6 次</text>
      </view>
    </view>

    <!-- 单词面板 -->
    <view class="word-panel" v-if="currentWord.word">
      <!-- 主线拼写：显示当前要收服的单词 -->
      <view v-if="phase === 'spelling'">
        <text class="meaning">{{ currentWord.meaning }}</text>
        <text class="phonetic" v-if="currentWord.phonetic">{{ currentWord.phonetic }}</text>
        <AudioPlayer :src="currentWord.audioUrl" label="听发音" />
        <text class="hint" @click="showFullWord = !showFullWord">
          {{ showFullWord ? currentWord.word : '👆 点击显示完整单词' }}
        </text>
      </view>

      <!-- 滚动检测：只显示释义，不显示发音和音标 -->
      <view v-else-if="phase === 'review'">
        <text class="review-badge">🔄 还记得这个词吗？</text>
        <text class="meaning big">{{ reviewWord.meaning }}</text>
      </view>

      <!-- 补考：回顾失败的词要重拼 6 次 -->
      <view v-else-if="phase === 'failBack'">
        <text class="meaning">{{ currentWord.meaning }}</text>
        <text class="phonetic" v-if="currentWord.phonetic">{{ currentWord.phonetic }}</text>
        <AudioPlayer :src="currentWord.audioUrl" label="听发音" />
        <text class="hint" @click="showFullWord = !showFullWord">
          {{ showFullWord ? currentWord.word : '👆 点击显示完整单词' }}
        </text>
      </view>
    </view>

    <SpellInput
      v-model="inputValue"
      :disabled="submitting"
      button-text="确认拼写"
      @submit="checkSpell"
    />

    <!-- 全组完成弹窗 -->
    <view class="success-mask" v-if="showComplete">
      <view class="success-box">
        <text class="success-icon">🎉</text>
        <text class="success-text">一组收服完成！</text>
        <text class="summary-text">成功收服 {{ caughtCount }} 个单词</text>
        <text class="coin-reward">+{{ totalCoinReward }} 💰</text>
        <text v-if="bonus > 0" class="bonus-text">连续收集 10 个单词，额外奖励 {{ bonus }} 金币！</text>
        <text v-else-if="caughtCount > 0 && totalCoinReward === 0" class="bonus-text">这些单词之前已收服过，本次不重复发放金币</text>
        <button class="primary-btn" @click="goHome">查看图鉴</button>
        <button class="ghost-btn" @click="resetAll">继续收服</button>
      </view>
    </view>
  </view>
</template>

<script>
import { getRandomWord, checkCatchableWord, batchCatchWords } from '@/api/word.js';
import SpellInput from '@/components/SpellInput/SpellInput.vue';
import AudioPlayer from '@/components/AudioPlayer/AudioPlayer.vue';
import store from '@/store/index.js';

export default {
  components: { SpellInput, AudioPlayer },
  data() {
    return {
      bookCode: '',
      bookName: '',
      pendingKey: '',
      // 当前在拼写的单词
      currentWord: {},
      currentCorrectCount: 0,
      totalCoinReward: 0,
      bonus: 0,
      caughtCount: 0,
      // 待收服池（拼满 6 次、尚未真正入库的单词，本地缓存跨会话保留）
      reviewPool: [],
      // 当前正在检测的回顾词
      reviewWord: {},
      reviewIndex: 0,
      reviewOrder: [],
      // 阶段
      phase: 'spelling', // spelling | review | failBack
      inputValue: '',
      submitting: false,
      showFullWord: false,
      showComplete: false,
      // 补考信息
      failBackWordId: null,
      // 是否从本地缓存恢复的进度
      restored: false,
    };
  },
  onLoad(options) {
    this.bookCode = options.bookCode || '';
    this.bookName = decodeURIComponent(options.bookName || '');
    this.pendingKey = 'pending_catch_' + this.bookCode;
    this.restorePending();
    if (!this.restored) {
      this.fetchWord();
    }
  },
  methods: {
    // 读取本地未结算的待收服进度
    restorePending() {
      try {
        const saved = uni.getStorageSync(this.pendingKey);
        if (saved && Array.isArray(saved.pool) && saved.pool.length > 0) {
          this.reviewPool = saved.pool;
          this.restored = true;
          // 恢复进度：若已攒满 10 个，直接提示结算；否则继续拼新词
          if (this.reviewPool.length >= 10) {
            this.doFinishGroup();
          } else {
            uni.showToast({ title: `已恢复 ${this.reviewPool.length} 个待收服单词`, icon: 'none' });
            this.fetchWord();
          }
        }
      } catch (e) {
        // 缓存读取失败则忽略，正常开新组
      }
    },
    // 保存待收服进度到本地
    savePending() {
      if (!this.pendingKey) return;
      try {
        uni.setStorageSync(this.pendingKey, { pool: this.reviewPool });
      } catch (e) {
        // 存储失败静默处理
      }
    },
    // 清空本地待收服进度
    clearPending() {
      if (!this.pendingKey) return;
      try {
        uni.removeStorageSync(this.pendingKey);
      } catch (e) {}
    },
    async fetchWord() {
      // 随机词可能重复抽到待收服池里已有的词，最多重试排除
      const pendingIds = this.reviewPool.map((w) => w.id);
      let res = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        res = await getRandomWord(this.bookCode);
        if (!res.data) break;
        if (!pendingIds.includes(res.data.id)) break;
        res = null; // 抽到重复词，继续重试
      }
      if (res && res.data) {
        this.currentWord = res.data;
        this.currentCorrectCount = 0;
        this.inputValue = '';
        this.showFullWord = false;
        this.phase = 'spelling';
      } else {
        uni.showToast({ title: (res && res.msg) || '暂无可收服单词', icon: 'none' });
      }
    },
    checkSpell() {
      if (!this.inputValue.trim() || this.submitting) return;
      this.submitting = true;
      const word = this.inputValue.trim().toLowerCase();
      this.inputValue = '';

      if (this.phase === 'review') {
        this.handleReviewResult(word);
      } else {
        this.handleSpellResult(word);
      }
    },
    // 主线拼写 / 补考拼写结果
    async handleSpellResult(word) {
      this.showFullWord = false;

      const ok = word === (this.currentWord.word || '').toLowerCase();

      if (ok) {
        this.currentCorrectCount += 1;
        uni.showToast({ title: `正确 (${this.currentCorrectCount}/6)`, icon: 'none' });

        if (this.currentCorrectCount >= 6) {
          if (this.phase === 'failBack') {
            // 补考通过 → 把单词放回回顾池，继续滚动检测
            this.reviewPool.push({ ...this.currentWord });
            this.savePending();
            this.phase = 'spelling';
            this.startReview();
          } else {
            // 正常拼满 6 次 → 本地判定入池（暂不入库）
            await this.doCaptureWord();
          }
        }
      } else {
        uni.showToast({ title: '拼写错误', icon: 'none' });
      }
      this.submitting = false;
    },
    // 拼满 6 次：只做本地判定，校验可收服后加入待收服池（暂不入库、不发币）
    async doCaptureWord() {
      try {
        // 校验该词当前仍可收服（避免本地缓存里已收服/遗弃的词残留）
        const res = await checkCatchableWord(this.currentWord.id);
        if (res.data && res.data.catchable) {
          this.reviewPool.push({ ...this.currentWord });
          this.savePending();
          this.startReview();
        } else {
          const reason = (res.data && res.data.reason) || '该词不可收服';
          uni.showToast({ title: reason, icon: 'none' });
          // 不可收服则换一个新词继续
          this.fetchWord();
        }
      } catch (e) {
        uni.showToast({ title: '校验失败: ' + (e && e.errMsg ? e.errMsg : (e.msg || '未知错误')), icon: 'none' });
        this.submitting = false;
      }
    },
    // 开始滚动检测
    startReview() {
      this.reviewIndex = 0;
      this.reviewOrder = [...this.reviewPool.map((w) => w.id)]; // 打乱顺序
      this.shuffleArray(this.reviewOrder);
      this.pickReviewWord();
      this.phase = 'review';
    },
    // 打乱数组（Fisher-Yates）
    shuffleArray(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    },
    // 按顺序选下一个回顾检测
    pickReviewWord() {
      if (this.reviewIndex >= this.reviewOrder.length) return;
      const targetId = this.reviewOrder[this.reviewIndex];
      const w = this.reviewPool.find((r) => r.id === targetId);
      if (!w) {
        // 该词已被踢出（补考），跳过
        this.reviewIndex += 1;
        return this.pickReviewWord();
      }
      this.reviewWord = {
        id: w.id,
        word: w.word,
        meaning: w.meaning,
        phonetic: w.phonetic,
        audioUrl: w.audioUrl,
      };
    },
    // 滚动检测结果
    handleReviewResult(word) {
      const ok = word === (this.reviewWord.word || '').toLowerCase();

      if (ok) {
        this.reviewIndex += 1;
        if (this.reviewIndex >= this.reviewOrder.length) {
          // 全部回顾通过
          uni.showToast({ title: '✅ 全组检测通过！', icon: 'success' });

          // 检查是否满 10 个
          if (this.reviewPool.length >= 10) {
            this.doFinishGroup();
          } else {
            // 学下一个新单词
            this.fetchWord();
          }
        } else {
          // 还有更多要检测的
          this.pickReviewWord();
          if (this.reviewWord.id) {
            uni.showToast({ title: '✅ 正确，继续检测', icon: 'none' });
          }
        }
      } else {
        // 回顾失败 → 这个单词踢出池子，重新拼 6 次
        const wordId = this.reviewWord.id;
        this.failBackWordId = wordId;
        // 从池中移除，并同步本地缓存
        this.reviewPool = this.reviewPool.filter((w) => w.id !== wordId);
        this.savePending();

        // 设置当前单词为回顾失败的词供补考
        this.currentWord = { ...this.reviewWord };
        this.currentCorrectCount = 0;
        this.phase = 'failBack';
        uni.showToast({ title: '😅 检测失败，重新拼 6 次', icon: 'none' });
      }
      this.submitting = false;
    },
    // 完成一组收服：攒满 10 个才真正入库并发币
    async doFinishGroup() {
      this.submitting = true;
      try {
        const wordIds = this.reviewPool.map((w) => w.id);
        const res = await batchCatchWords(wordIds);
        if (res.data) {
          const { results = [], totalCoinReward = 0, bonus = 0 } = res.data;
          // 用后端返回的真实数值展示奖励（客户端不能再拿 reviewPool 估算：
          // 下面清空 reviewPool 后就变成 0 了，且已收服/重新激活的词本就不发币）
          this.totalCoinReward = totalCoinReward;
          this.bonus = bonus;
          this.caughtCount = results.filter((r) => r && !r.error).length;
          // 收集结算失败的词（保留在待收服池，下次继续）
          const failedIds = new Set(
            results
              .filter((r) => r && r.error)
              .map((r) => r.wordId)
          );
          if (failedIds.size > 0) {
            const failedWords = this.reviewPool.filter((w) => failedIds.has(w.id));
            this.reviewPool = failedWords;
            this.savePending();
            uni.showToast({ title: `${failedIds.size} 个词结算失败，已保留`, icon: 'none' });
          } else {
            // 全部成功：清空本地待收服缓存，并刷新图鉴
            this.reviewPool = [];
            this.clearPending();
            await store.fetchCards(true);
          }
          this.showComplete = true;
        }
      } catch (e) {
        uni.showToast({ title: '收服失败: ' + (e && e.errMsg ? e.errMsg : (e.msg || '未知错误')), icon: 'none' });
      } finally {
        this.submitting = false;
      }
    },
    goHome() {
      uni.reLaunch({ url: '/pages/index/index' });
    },
    doRefresh() {
      // 只换当前拼写的单词，不重置已收服的进度
      if (this.phase === 'spelling' || this.phase === 'failBack') {
        this.fetchWord();
      }
    },
    resetAll() {
      this.showComplete = false;
      this.currentWord = {};
      this.currentCorrectCount = 0;
      this.totalCoinReward = 0;
      this.bonus = 0;
      this.caughtCount = 0;
      this.reviewPool = [];
      this.reviewWord = {};
      this.reviewIndex = 0;
      this.reviewOrder = [];
      this.phase = 'spelling';
      this.clearPending();
      store.fetchCards(true);
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
  padding-bottom: calc(30rpx + env(safe-area-inset-bottom));
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.refresh-btn {
  font-size: 22rpx;
  color: #999;
  padding: 6rpx 16rpx;
  border: 2rpx solid #ddd;
  border-radius: 24rpx;
}

.book-name {
  font-size: 30rpx;
  font-weight: bold;
}

.progress-area {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.progress {
  font-size: 24rpx;
  color: #4a90e2;
}

.bonus {
  font-size: 20rpx;
  color: #fff;
  background: #ff9800;
  padding: 4rpx 12rpx;
  border-radius: 20rpx;
  font-weight: bold;
}

/* 阶段提示 */
.stage-hint {
  margin-bottom: 24rpx;
}

.stage-tag {
  display: inline-block;
  font-size: 22rpx;
  color: #4a90e2;
  background: rgba(74, 144, 226, 0.1);
  padding: 6rpx 20rpx;
  border-radius: 20rpx;
}

.stage-tag.review-stage {
  color: #ff9800;
  background: rgba(255, 152, 0, 0.1);
}

.stage-tag.fail-stage {
  color: #e53935;
  background: rgba(229, 57, 53, 0.1);
}

/* 单词面板 */
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

.meaning.big {
  font-size: 36rpx;
  color: #333;
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

.review-badge {
  display: block;
  font-size: 22rpx;
  color: #fff;
  background: #ff9800;
  padding: 4rpx 16rpx;
  border-radius: 20rpx;
  width: 180rpx;
  margin: 0 auto 24rpx;
}

/* 成功弹窗 */
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

.summary-text {
  display: block;
  font-size: 26rpx;
  color: #666;
  margin-bottom: 8rpx;
}

.coin-reward {
  display: block;
  font-size: 40rpx;
  color: #ff9800;
  font-weight: bold;
  margin: 8rpx 0;
}

.bonus-text {
  display: block;
  font-size: 24rpx;
  color: #e65100;
  margin-bottom: 16rpx;
  background: #fff8e1;
  padding: 8rpx 16rpx;
  border-radius: 12rpx;
}

.primary-btn {
  background: #4a90e2;
  color: #fff;
  border-radius: 40rpx;
  margin-bottom: 16rpx;
  width: 300rpx;
}

.ghost-btn {
  background: #f5f5f5;
  color: #666;
  border-radius: 40rpx;
}
</style>
