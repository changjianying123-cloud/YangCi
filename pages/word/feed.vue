<template>
  <view class="page">
    <view v-if="card.id" class="content">
      <!-- 单词蛋：孵化状态 -->
      <view v-if="card.isEgg" class="egg-section">
        <view class="egg-icon">🥚</view>
        <text class="egg-title">这是一个单词蛋</text>
        <text class="egg-desc">由于长期未喂养，单词退化成了蛋，需要重新孵化</text>
        <button class="hatch-btn" :disabled="hatching" @click="doHatch">
          {{ hatching ? '孵化中...' : '🥚 孵化单词蛋' }}
        </button>
      </view>

      <!-- 正常卡牌 -->
      <view v-else>
        <view class="status-bar" :style="{ background: statusColor }">
          <text>{{ statusText }} · {{ levelLabel }}</text>
        </view>

        <view class="word-panel">
          <text class="word-text">{{ card.word }}</text>
          <text class="meaning">{{ card.meaning }}</text>
          <text class="phonetic" v-if="card.phonetic">{{ card.phonetic }}</text>
          <AudioPlayer :src="card.audioUrl" label="听发音" />
          <view class="feed-info">
            <text class="deadline">{{ card.nextFeedIn }}</text>
            <text v-if="card.canFeed" class="window-open">✅ 窗口开放中，可以喂养</text>
            <text v-else class="window-closed">⏳ 未到喂养时间</text>
          </view>
        </view>

        <!-- 拼写喂养区 -->
        <view v-if="card.canFeed" class="spell-section">
          <view class="section-title">
            <text>拼写喂养</text>
            <text class="spell-progress">正确 {{ spellCount }} / {{ spellRequired }}</text>
          </view>

          <!-- 进度指示 -->
          <view class="progress-bar">
            <view
              v-for="i in spellRequired"
              :key="i"
              class="progress-dot"
              :class="{ filled: i <= spellCount }"
            ></view>
          </view>

          <!-- 已拼完 -->
          <view v-if="spellCount >= spellRequired" class="spell-done">
            <text class="spell-done-text">✅ 已完成全部拼写，请确认喂养</text>
            <button class="feed-btn" :disabled="submitting" @click="confirmFeed">
              {{ submitting ? '喂养中...' : '确认喂养' }}
            </button>
          </view>

          <!-- 未拼完 -->
          <view v-else class="spell-input-area">
            <view class="word-hint">
              <text>{{ card.meaning }}</text>
              <text class="phonetic-muted" v-if="card.phonetic">{{ card.phonetic }}</text>
            </view>
            <SpellInput
              v-model="spellValue"
              :disabled="submitting"
              button-text="提交拼写"
              @submit="submitSpell"
            />
            <text class="spell-count-text">已正确拼写 {{ spellCount }} 次，还需 {{ spellRequired - spellCount }} 次</text>
          </view>

          <text class="level-next">喂养后 → {{ nextLevelLabel }}</text>
        </view>

        <!-- 不可喂养时显示提示 -->
        <view v-else class="no-feed-tip">
          <text class="tip-icon">⏰</text>
          <text class="tip-text">{{ card.nextFeedIn }}</text>
          <text class="tip-sub">提前喂养无效，请耐心等待窗口开启</text>
        </view>
      </view>
    </view>

    <view v-else class="empty">加载卡牌中...</view>
  </view>
</template>

<script>
import { getCardDetail, feedCard, hatchEgg } from '@/api/card.js';
import SpellInput from '@/components/SpellInput/SpellInput.vue';
import AudioPlayer from '@/components/AudioPlayer/AudioPlayer.vue';
import { cardStatusText, cardStatusColor, levelLabel } from '@/utils/common.js';
import store from '@/store/index.js';

export default {
  components: { SpellInput, AudioPlayer },
  data() {
    return {
      cardId: null,
      card: {},
      spellValue: '',
      spellCount: 0,
      spellRequired: 3,
      submitting: false,
      hatching: false,
    };
  },
  computed: {
    statusText() {
      return cardStatusText(this.card.status);
    },
    statusColor() {
      return cardStatusColor(this.card.status);
    },
    levelLabel() {
      return levelLabel(this.card.level);
    },
    nextLevelLabel() {
      return levelLabel(Math.min((this.card.level || 0) + 1, 5));
    },
  },
  onLoad(options) {
    this.cardId = options.cardId;
    this.loadCard();
  },
  methods: {
    async loadCard() {
      const res = await getCardDetail(this.cardId);
      if (res.data) {
        this.card = res.data;
        this.spellCount = res.data.feedSpellCount || 0;
        this.spellRequired = res.data.feedSpellRequired || 3;
      }
    },
    async submitSpell() {
      if (this.submitting || !this.spellValue.trim()) return;
      const ok = this.spellValue.trim().toLowerCase() === (this.card.word || '').toLowerCase();
      if (!ok) {
        uni.showToast({ title: '拼写错误，再试试', icon: 'none' });
        this.spellValue = '';
        return;
      }

      this.submitting = true;
      try {
        const res = await feedCard(this.cardId, { spell_correct: true });
        if (res.data) {
          this.spellCount = res.data.count;
          this.spellRequired = res.data.required;
          if (res.data.done) {
            uni.showToast({ title: '喂养成功！🎉', icon: 'success' });
            await store.fetchCards(true);
            setTimeout(() => uni.navigateBack(), 1000);
          } else {
            uni.showToast({ title: `拼写正确 ${res.data.count}/${res.data.required}`, icon: 'none' });
          }
        }
        this.spellValue = '';
      } catch (e) {
        this.spellValue = '';
      } finally {
        this.submitting = false;
      }
    },
    async confirmFeed() {
      // 如果服务端已经处理完了但还没跳转，再调一次确保
      if (this.submitting) return;
      this.submitting = true;
      try {
        const res = await feedCard(this.cardId, { spell_correct: true });
        if (res.data && res.data.done) {
          uni.showToast({ title: '喂养成功！🎉', icon: 'success' });
          await store.fetchCards(true);
          setTimeout(() => uni.navigateBack(), 1000);
        }
      } catch (e) {
        // 已 toast
      } finally {
        this.submitting = false;
      }
    },
    async doHatch() {
      if (this.hatching) return;
      this.hatching = true;
      try {
        await hatchEgg(this.cardId);
        uni.showToast({ title: '孵化成功！可以开始喂养', icon: 'success' });
        await this.loadCard();
        await store.fetchCards(true);
      } catch (e) {
        // request 内已 toast
      } finally {
        this.hatching = false;
      }
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f7f8fa;
  padding: 24rpx;
}

/* 单词蛋 */
.egg-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 40rpx;
}

.egg-icon {
  font-size: 160rpx;
  margin-bottom: 32rpx;
  animation: eggBounce 2s ease-in-out infinite;
}

@keyframes eggBounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-20rpx); }
}

.egg-title {
  font-size: 36rpx;
  font-weight: bold;
  margin-bottom: 16rpx;
}

.egg-desc {
  font-size: 26rpx;
  color: #999;
  text-align: center;
  margin-bottom: 48rpx;
}

.hatch-btn {
  background: linear-gradient(135deg, #ff9800, #ffc107);
  color: #fff;
  border-radius: 48rpx;
  width: 360rpx;
  font-size: 30rpx;
}

/* 正常卡牌 */
.status-bar {
  color: #fff;
  padding: 16rpx 24rpx;
  border-radius: 12rpx;
  font-size: 26rpx;
  margin-bottom: 24rpx;
}

.word-panel {
  background: #fff;
  border-radius: 20rpx;
  padding: 40rpx;
  text-align: center;
  margin-bottom: 32rpx;
}

.word-text {
  display: block;
  font-size: 44rpx;
  font-weight: bold;
  margin-bottom: 8rpx;
  color: #333;
}

.meaning {
  display: block;
  font-size: 32rpx;
  color: #666;
  margin-bottom: 8rpx;
}

.phonetic {
  display: block;
  font-size: 26rpx;
  color: #999;
  margin-bottom: 24rpx;
}

.feed-info {
  margin-top: 24rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f0f0;
}

.deadline {
  display: block;
  font-size: 26rpx;
  color: #ff9800;
  margin-bottom: 8rpx;
}

.window-open {
  display: block;
  font-size: 24rpx;
  color: #4caf50;
}

.window-closed {
  display: block;
  font-size: 24rpx;
  color: #999;
}

/* 拼写区域 */
.spell-section {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 28rpx;
  font-weight: bold;
  margin-bottom: 16rpx;
}

.spell-progress {
  font-size: 26rpx;
  color: #4a90e2;
  font-weight: bold;
}

.progress-bar {
  display: flex;
  gap: 16rpx;
  justify-content: center;
  margin-bottom: 24rpx;
  padding: 8rpx 0;
}

.progress-dot {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: #e0e0e0;
  transition: all 0.3s;
}

.progress-dot.filled {
  background: #4caf50;
  box-shadow: 0 0 8rpx rgba(76, 175, 80, 0.5);
}

.spell-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24rpx 0;
}

.spell-done-text {
  font-size: 28rpx;
  color: #4caf50;
  margin-bottom: 32rpx;
}

.feed-btn {
  background: #ff9500;
  color: #fff;
  border-radius: 48rpx;
  width: 320rpx;
}

.spell-input-area {
  padding: 8rpx 0;
}

.word-hint {
  text-align: center;
  padding: 16rpx;
  background: #f0f8ff;
  border-radius: 12rpx;
  margin-bottom: 20rpx;
}

.word-hint text {
  display: block;
  font-size: 32rpx;
  color: #333;
}

.phonetic-muted {
  font-size: 24rpx !important;
  color: #999 !important;
  margin-top: 4rpx;
}

.spell-count-text {
  display: block;
  text-align: center;
  font-size: 24rpx;
  color: #999;
  margin-top: 16rpx;
}

.level-next {
  display: block;
  text-align: center;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: #999;
  padding-top: 20rpx;
  border-top: 1rpx solid #f0f0f0;
}

/* 不可喂养提示 */
.no-feed-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 40rpx;
  background: #fff;
  border-radius: 20rpx;
}

.tip-icon {
  font-size: 60rpx;
  margin-bottom: 16rpx;
}

.tip-text {
  font-size: 28rpx;
  color: #ff9800;
  margin-bottom: 8rpx;
}

.tip-sub {
  font-size: 24rpx;
  color: #999;
}

.empty {
  text-align: center;
  padding: 120rpx;
  color: #999;
}
</style>
