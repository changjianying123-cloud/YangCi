<template>
  <view class="page">
    <!-- 顶部金币栏 -->
    <view class="coin-bar">
      <text class="coin-display">💰 {{ coins }}</text>
      <text class="coin-hint">答对提升心情，答错降低心情</text>
    </view>

    <view v-if="question.word" class="content">
      <!-- 心情条 -->
      <view class="mood-status-bar" :style="{ background: moodBgColor }">
        <text class="mood-emoji">{{ moodEmoji }}</text>
        <text class="mood-label">{{ moodLabel }}</text>
        <text class="mood-score">{{ moodScoreText }}</text>
      </view>

      <!-- 题目：看英文选中文 -->
      <view class="word-panel">
        <text class="challenge-label">🎈 玩耍 · 选词复习</text>
        <text class="ask-word">{{ question.word }}</text>
        <text v-if="question.phonetic" class="ask-phonetic">{{ question.phonetic }}</text>
        <AudioPlayer :src="question.audioUrl" label="听发音" />
        <text class="ask-hint">选出正确的中文意思</text>

        <!-- 四个选项 -->
        <view class="options">
          <view
            v-for="(opt, idx) in question.options"
            :key="idx"
            class="option"
            :class="optionClass(opt)"
            @click="choose(opt)"
          >
            <text class="option-key">{{ ['A', 'B', 'C', 'D'][idx] }}</text>
            <text class="option-text">{{ opt.text }}</text>
            <text v-if="picked && opt.correct" class="option-mark">✅</text>
            <text v-else-if="picked === opt.text" class="option-mark">❌</text>
          </view>
        </view>

        <!-- 结果反馈 -->
        <view v-if="picked" class="feedback" :class="{ good: lastCorrect, bad: !lastCorrect }">
          <text class="feedback-title">{{ lastCorrect ? '🎉 答对了！心情 +1' : '😔 答错了，心情 -1' }}</text>
          <text class="feedback-sub" v-if="!lastCorrect">正确答案：{{ lastCorrectText }}</text>
          <text class="feedback-sub" v-if="lastCoin > 0">💰 单词开心起来了，奖励 +{{ lastCoin }} 金币</text>
        </view>

        <button v-if="picked" class="next-btn" @click="nextQuestion">
          🎈 继续玩耍（换成另一个单词）
        </button>
      </view>

      <!-- 说明 -->
      <view class="tips">
        <text class="tip-line">🎈 玩耍和喂养一样，都算复习这个单词</text>
        <text class="tip-line">🔀 点「继续玩耍」会换成另一个单词</text>
        <text class="tip-line">😊 连续答对让它开心，它会给你金币</text>
        <text class="tip-line">😢 答错会让它难过，记得多陪它玩</text>
      </view>
    </view>

    <view v-else class="empty">加载中...</view>
  </view>
</template>

<script>
import { getPlayQuestion, submitPlayAnswer, getRandomPlayCard } from '@/api/card.js';
import AudioPlayer from '@/components/AudioPlayer/AudioPlayer.vue';
import { moodSymbol } from '@/utils/common.js';
import store from '@/store/index.js';

export default {
  components: { AudioPlayer },
  data() {
    return {
      cardId: null,
      question: {},
      coins: 0,
      picked: null,
      submitted: false, // 已交答案，等后端返回
      lastCorrect: false,
      lastCorrectText: '',
      lastCoin: 0,
      moodNow: 'none',
      moodValue: 0,
      correctStreak: 0,
      loading: false,
      switching: false, // 换词中，防连点
    };
  },
  computed: {
    moodEmoji() {
      return moodSymbol(this.moodNow);
    },
    moodLabel() {
      const map = { happy: '心情很好', sad: '有点难过', none: '心情平静' };
      return map[this.moodNow] || '心情平静';
    },
    moodScoreText() {
      const v = this.moodValue;
      if (v > 0) return `+${v}`;
      return String(v);
    },
    moodBgColor() {
      const map = {
        happy: 'linear-gradient(135deg, #4caf50, #81c784)',
        sad: 'linear-gradient(135deg, #f44336, #ef9a9a)',
        none: 'linear-gradient(135deg, #78909c, #b0bec5)',
      };
      return map[this.moodNow] || map.none;
    },
  },
  onLoad(options) {
    this.cardId = options.cardId;
    this.loadQuestion();
  },  methods: {
    optionClass(opt) {
      if (!this.picked) return '';
      if (opt.correct) return 'correct';
      if (this.picked === opt.text) return 'wrong';
      return 'dim';
    },
    async loadQuestion() {
      if (this.loading) return;
      this.loading = true;
      try {
        const res = await getPlayQuestion(this.cardId);
        if (res.data) {
          this.question = res.data;
          this.moodNow = res.data.mood || 'none';
          this.moodValue = res.data.moodScore || 0;
          this.coins = this.coins || 0;
          // 重置本轮答题状态
          this.picked = null;
          this.lastCorrect = false;
          this.lastCorrectText = '';
          this.lastCoin = 0;
        }
      } catch (e) {
        uni.showToast({ title: e.errMsg || '加载题目失败', icon: 'none' });
      } finally {
        this.loading = false;
      }
    },
    async choose(opt) {
      if (this.picked || this.submitted) return; // 已选，防止连点
      this.picked = opt.text;
      this.submitted = true;
      try {
        const res = await submitPlayAnswer(this.cardId, opt.text);
        const d = res.data || {};
        this.lastCorrect = !!d.correct;
        this.lastCorrectText = d.correctMeaning || '';
        this.lastCoin = d.coinReward || 0;
        this.moodNow = d.mood || 'none';
        this.moodValue = d.moodScore || 0;
        this.coins = d.coins != null ? d.coins : this.coins;
        if (this.lastCorrect) this.correctStreak += 1;
        else this.correctStreak = 0;
        // 同步卡片列表（心情会显示在卡片上）
        await store.fetchCards(true);
      } catch (e) {
        // 失败则回退选择状态，允许重试
        this.picked = null;
        uni.showToast({ title: e.errMsg || '提交失败', icon: 'none' });
      } finally {
        this.submitted = false;
      }
    },
    async nextQuestion() {
      // 换一个单词继续玩耍（同一个词反复刷太枯燥）
      if (this.switching) return;
      this.switching = true;
      try {
        const res = await getRandomPlayCard(this.cardId);
        if (res.data && res.data.cardId) {
          // 若换了单词，重新拉该词的题目
          if (Number(res.data.cardId) !== Number(this.cardId)) {
            this.cardId = res.data.cardId;
            uni.setNavigationBarTitle({ title: `玩耍：${res.data.word}` });
          }
          await this.loadQuestion();
        } else {
          // 只有这一张卡了 → 原词再出一题
          uni.showToast({ title: '只有这一个单词，再玩一题吧', icon: 'none', duration: 1500 });
          await this.loadQuestion();
        }
      } catch (e) {
        // 没有其它可玩的词 → 原词继续
        uni.showToast({ title: '没有其它可玩耍的单词了', icon: 'none', duration: 1500 });
        await this.loadQuestion();
      } finally {
        this.switching = false;
      }
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f0f2f5;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
}

.empty {
  text-align: center;
  padding: 120rpx;
  color: #999;
}

/* 金币栏 */
.coin-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 24rpx;
  background: linear-gradient(135deg, #ffd54f, #ffb300);
  border-radius: 16rpx;
  margin-bottom: 16rpx;
}

.coin-display {
  font-size: 32rpx;
  font-weight: bold;
  color: #5d4037;
}

.coin-hint {
  font-size: 22rpx;
  color: #6d4c41;
}

/* 心情条 */
.mood-status-bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  margin-bottom: 16rpx;
  color: #fff;
}

.mood-emoji {
  font-size: 44rpx;
}

.mood-label {
  font-size: 28rpx;
  font-weight: bold;
  flex: 1;
}

.mood-score {
  font-size: 26rpx;
  opacity: 0.9;
}

/* 题目面板 */
.word-panel {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;
  text-align: center;
}

.challenge-label {
  display: block;
  font-size: 22rpx;
  color: #fff;
  background: #7e57c2;
  padding: 6rpx 20rpx;
  border-radius: 20rpx;
  width: 210rpx;
  margin: 0 auto 28rpx;
}

.ask-word {
  display: block;
  font-size: 56rpx;
  font-weight: bold;
  color: #212121;
  margin-bottom: 8rpx;
}

.ask-phonetic {
  display: block;
  font-size: 26rpx;
  color: #9e9e9e;
  margin-bottom: 8rpx;
}

.ask-hint {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin: 16rpx 0 24rpx;
}

/* 选项 */
.options {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}

.option {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 26rpx 24rpx;
  background: #f7f8fa;
  border: 2rpx solid #e0e0e0;
  border-radius: 16rpx;
  transition: all 0.15s;
}

.option:active {
  transform: scale(0.985);
}

.option-key {
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  border-radius: 50%;
  background: #e0e0e0;
  color: #616161;
  font-size: 24rpx;
  flex-shrink: 0;
}

.option-text {
  flex: 1;
  font-size: 30rpx;
  color: #333;
  text-align: left;
}

.option-mark {
  font-size: 30rpx;
}

.option.correct {
  background: #e8f5e9;
  border-color: #4caf50;
}

.option.correct .option-key {
  background: #4caf50;
  color: #fff;
}

.option.wrong {
  background: #ffebee;
  border-color: #f44336;
}

.option.wrong .option-key {
  background: #f44336;
  color: #fff;
}

.option.dim {
  opacity: 0.5;
}

/* 结果反馈 */
.feedback {
  margin-top: 24rpx;
  padding: 22rpx;
  border-radius: 16rpx;
  text-align: center;
}

.feedback.good {
  background: #e8f5e9;
}

.feedback.bad {
  background: #ffebee;
}

.feedback-title {
  display: block;
  font-size: 30rpx;
  font-weight: bold;
  margin-bottom: 8rpx;
}

.feedback.good .feedback-title {
  color: #2e7d32;
}

.feedback.bad .feedback-title {
  color: #c62828;
}

.feedback-sub {
  display: block;
  font-size: 25rpx;
  color: #616161;
  margin-top: 6rpx;
}

.next-btn {
  margin-top: 28rpx;
  background: linear-gradient(135deg, #7e57c2, #9575cd);
  color: #fff;
  border-radius: 44rpx;
  font-size: 30rpx;
  line-height: 84rpx;
  height: 84rpx;
}

/* 说明 */
.tips {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx 32rpx;
}

.tip-line {
  display: block;
  font-size: 24rpx;
  color: #757575;
  line-height: 1.9;
}
</style>
