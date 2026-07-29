<template>
  <view
    class="word-card"
    :class="[
      'status-' + card.status,
      { disabled: card.isEgg, pulse: card.status === 'incubating' || card.status === 'hungry' },
    ]"
    @click="handleClick"
  >
    <view class="card-bg" :style="cardStyle">
      <view class="card-shine" />
      <!-- 单词蛋 -->
      <view v-if="card.isEgg" class="egg-card">
        <text class="egg-icon">🥚</text>
        <text class="egg-text">单词蛋</text>
      </view>
      <!-- 正常卡牌 -->
      <view v-else>
        <view class="card-header">
          <view class="level-tag">{{ levelLabel }}</view>
          <view class="header-right">
            <text class="mood-tag">{{ moodEmoji }}</text>
            <text class="status-tag">{{ statusText }}</text>
          </view>
        </view>
        <text class="word">{{ card.word }}</text>
        <text class="meaning">{{ card.meaning }}</text>
        <view class="card-footer">
          <text class="deadline">{{ card.nextFeedIn }}</text>
          <text v-if="card.status === 'incubating'" class="feed-tip">🍼 可喂养</text>
          <text v-else-if="card.status === 'hungry'" class="feed-tip urgent">⚠️ 饥饿</text>
          <text v-else-if="card.status === 'downgraded'" class="feed-tip">⬇️ 已降级</text>
          <text v-else-if="card.status === 'normal'" class="feed-tip normal">✅ 健康</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { cardStatusText, levelLabel, moodSymbol } from '@/utils/common.js';

const CARD_STYLES = {
  egg: '#e0e0e0',
  incubating: 'linear-gradient(135deg, #ff9800 0%, #ffc107 100%)',
  hungry: 'linear-gradient(135deg, #f44336 0%, #ff7043 100%)',
  downgraded: 'linear-gradient(135deg, #9c27b0 0%, #ce93d8 100%)',
  normal: 'linear-gradient(135deg, #4caf50 0%, #81c784 100%)',
};

export default {
  name: 'WordCard',
  props: {
    card: { type: Object, required: true },
    compact: { type: Boolean, default: false },
  },
  computed: {
    statusText() {
      return cardStatusText(this.card.status);
    },
    levelLabel() {
      return levelLabel(this.card.level);
    },
    moodEmoji() {
      return moodSymbol(this.card.mood);
    },
    cardStyle() {
      if (this.card.isEgg) return { background: CARD_STYLES.egg };
      return { background: CARD_STYLES[this.card.status] || CARD_STYLES.normal };
    },
  },
  methods: {
    handleClick() {
      this.$emit('click', this.card);
    },
  },
};
</script>

<style scoped>
.word-card {
  width: 100%;
}

.word-card.disabled {
  opacity: 0.6;
}

.word-card.pulse .card-bg {
  animation: cardPulse 2s ease-in-out infinite;
}

@keyframes cardPulse {
  0%, 100% { transform: scale(1); box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.12); }
  50% { transform: scale(1.02); box-shadow: 0 12rpx 32rpx rgba(255, 152, 0, 0.35); }
}

.card-bg {
  position: relative;
  border-radius: 20rpx;
  padding: 24rpx;
  overflow: hidden;
  min-height: 200rpx;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.12);
  transition: transform 0.2s;
}

.word-card:active .card-bg {
  transform: scale(0.97);
}

.card-shine {
  position: absolute;
  top: -50%;
  right: -30%;
  width: 200rpx;
  height: 200rpx;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 50%;
}

/* 单词蛋 */
.egg-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 160rpx;
}

.egg-icon {
  font-size: 48rpx;
}

.egg-text {
  font-size: 24rpx;
  color: #666;
  margin-top: 8rpx;
}

/* 正常卡牌 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
  position: relative;
  z-index: 1;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.level-tag {
  font-size: 20rpx;
  color: #fff;
  background: rgba(0, 0, 0, 0.2);
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}

.mood-tag {
  font-size: 24rpx;
}

.status-tag {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.2);
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}

.word {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  color: #fff;
  margin-bottom: 6rpx;
  position: relative;
  z-index: 1;
  text-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.2);
}

.meaning {
  display: block;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.9);
  position: relative;
  z-index: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-footer {
  margin-top: 16rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  z-index: 1;
}

.deadline {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.75);
}

.feed-tip {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.95);
}

.feed-tip.urgent {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0.4; }
}

.feed-tip.normal {
  color: #fff;
  font-weight: bold;
}
</style>
