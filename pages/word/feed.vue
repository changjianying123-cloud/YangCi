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
        <!-- 心情 + 状态 -->
        <view class="mood-status-bar" :style="{ background: statusColor }">
          <text class="mood-emoji">{{ moodEmoji }}</text>
          <text class="status-tag">{{ statusText }} · {{ levelLabel }}</text>
        </view>

        <view class="word-panel">
          <text class="word-text">{{ card.word }}</text>
          <text class="meaning">{{ card.meaning }}</text>
          <text class="phonetic" v-if="card.phonetic">{{ card.phonetic }}</text>
          <AudioPlayer :src="card.audioUrl" label="听发音" />
          <view class="feed-info">
            <text class="deadline">{{ card.nextFeedIn }}</text>
            <text v-if="card.hasRemedialWindow" class="remedial-badge">🔄 补救喂养窗口</text>
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

          <!-- Lv.1 进度条（需要2次） -->
          <view v-if="card.isLv1" class="lv1-progress">
            <text class="lv1-text">Lv.1 需喂养 2 次才能升级</text>
            <view class="lv1-dots">
              <view class="lv1-dot" :class="{ done: card.lv1FeedProgress >= 1 }">①</view>
              <view class="lv1-arrow">→</view>
              <view class="lv1-dot" :class="{ done: card.lv1FeedProgress >= 2 }">②</view>
            </view>
          </view>

          <!-- 已拼完 -->
          <view v-if="spellCount >= spellRequired" class="spell-done">
            <text class="spell-done-text">✅ 拼写正确，请确认喂养</text>
            <button class="feed-btn" :disabled="submitting" @click="confirmFeed">
              {{ submitting ? '喂养中...' : '确认喂养' }}
            </button>
            <text v-if="card.mood === 'sad'" class="remedial-warning">😢 之前拼写错了，喂养后需2小时补救喂养</text>
          </view>

          <!-- 未拼完 -->
          <view v-else class="spell-input-area">
            <view class="mood-hint" :class="{ sad: card.mood === 'sad' }">
              <text class="mood-hint-emoji">{{ moodEmoji }}</text>
              <text class="mood-hint-text">
                {{ card.mood === 'sad' ? '单词很伤心，快拼对吧 😢' : '单词很开心，等你的拼写 😊' }}
              </text>
            </view>
            <view class="word-hint">
              <text>{{ card.meaning }}</text>
              <text class="phonetic-muted" v-if="card.phonetic">{{ card.phonetic }}</text>
            </view>
            <view class="word-reveal" @click="showFullWord = !showFullWord">
              <text>{{ showFullWord ? card.word : '👆 点击显示完整单词' }}</text>
            </view>
            <SpellInput
              v-model="spellValue"
              :disabled="submitting"
              button-text="提交拼写"
              @submit="submitSpell"
            />
          </view>

          <text class="level-next">喂养后 → {{ nextLevelLabel }}</text>
        </view>

        <!-- 不可喂养时显示提示 -->
        <view v-else class="no-feed-tip">
          <text class="tip-icon">⏰</text>
          <text class="tip-text">{{ card.nextFeedIn }}</text>
          <text class="tip-sub">提前喂养无效，请耐心等待窗口开启</text>
        </view>

        <!-- 补救喂养提示 -->
        <view v-if="card.hasRemedial && !card.canFeed" class="remedial-section">
          <text class="remedial-icon">🔄</text>
          <text class="remedial-text">还有补救喂养待完成：{{ card.nextFeedIn }}</text>
        </view>

        <!-- 遗弃按钮 -->
        <view class="abandon-section" v-if="!card.isEgg">
          <button class="abandon-btn" @click="confirmAbandon">🗑️ 遗弃此单词</button>
        </view>
      </view>
    </view>

    <view v-else class="empty">加载卡牌中...</view>
  </view>
</template>

<script>
import { getCardDetail, feedCard, hatchEgg, abandonCard } from '@/api/card.js';
import SpellInput from '@/components/SpellInput/SpellInput.vue';
import AudioPlayer from '@/components/AudioPlayer/AudioPlayer.vue';
import { cardStatusText, cardStatusColor, levelLabel, moodSymbol } from '@/utils/common.js';
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
      showFullWord: false,
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
      return levelLabel(Math.min((this.card.level || 0) + 1, 8));
    },
    moodEmoji() {
      return moodSymbol(this.card.mood);
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
        this.spellRequired = res.data.feedSpellRequired || 1;
      }
    },
    async submitSpell() {
      if (this.submitting || !this.spellValue.trim()) return;
      const ok = this.spellValue.trim().toLowerCase() === (this.card.word || '').toLowerCase();

      this.submitting = true;
      try {
        if (!ok) {
          await feedCard(this.cardId, { spell_correct: false });
          uni.showToast({ title: '拼写错误，单词很伤心 😢', icon: 'none' });
          this.spellValue = '';
          await this.loadCard();
          return;
        }

        const res = await feedCard(this.cardId, { spell_correct: true });
        if (res.data) {
          this.spellCount = res.data.count;
          this.spellRequired = res.data.required;

          if (res.data.done) {
            const moodEmoji = res.data.moodEmoji || '😊';
            uni.showToast({ title: `喂养成功！${moodEmoji}`, icon: 'success' });
            await store.fetchCards(true);
            setTimeout(() => uni.navigateBack(), 1000);
          } else {
            uni.showToast({ title: res.data.message || `拼写正确 (${res.data.count}/${res.data.required})`, icon: 'none' });
            this.spellValue = '';
            await this.loadCard();
          }
        }
      } catch (e) {
        uni.showToast({ title: e.errMsg || '操作失败', icon: 'none' });
      } finally {
        this.submitting = false;
      }
    },
    async confirmFeed() {
      if (this.submitting) return;
      this.submitting = true;
      try {
        const res = await feedCard(this.cardId, { spell_correct: true });
        if (res.data && res.data.done) {
          const moodEmoji = res.data.moodEmoji || '😊';
          uni.showToast({ title: `喂养成功！${moodEmoji}`, icon: 'success' });
          await store.fetchCards(true);
          setTimeout(() => uni.navigateBack(), 1000);
        }
      } catch (e) {
        uni.showToast({ title: e.errMsg || '喂养失败', icon: 'none' });
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
        uni.showToast({ title: e.errMsg || '孵化失败', icon: 'none' });
      } finally {
        this.hatching = false;
      }
    },
    confirmAbandon() {
      uni.showModal({
        title: '遗弃单词',
        content: `确定要遗弃「${this.card.word}」吗？遗弃后可在收服页面重新收服。`,
        success: async (res) => {
          if (res.confirm) {
            try {
              await abandonCard(this.cardId);
              uni.showToast({ title: '已遗弃', icon: 'success' });
              await store.fetchCards(true);
              setTimeout(() => uni.navigateBack(), 500);
            } catch (e) {
              uni.showToast({ title: '遗弃失败', icon: 'none' });
            }
          }
        },
      });
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

/* 心情状态栏 */
.mood-status-bar {
  color: #fff;
  padding: 16rpx 24rpx;
  border-radius: 12rpx;
  margin-bottom: 24rpx;
  display: flex;
  align-items: center;
}

.mood-emoji {
  font-size: 36rpx;
  margin-right: 12rpx;
}

.status-tag {
  font-size: 26rpx;
}

/* 正常卡牌 */
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

.remedial-badge {
  display: inline-block;
  font-size: 22rpx;
  color: #ff6f00;
  background: #fff3e0;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  margin-bottom: 6rpx;
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

/* Lv.1 进度条 */
.lv1-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16rpx;
  background: #fff8e1;
  border-radius: 12rpx;
  margin-bottom: 24rpx;
}

.lv1-text {
  font-size: 22rpx;
  color: #e65100;
  margin-bottom: 12rpx;
}

.lv1-dots {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.lv1-dot {
  font-size: 36rpx;
  opacity: 0.4;
}

.lv1-dot.done {
  opacity: 1;
}

.lv1-arrow {
  font-size: 28rpx;
  color: #999;
}

/* 心情提示 */
.mood-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12rpx;
  background: #e8f5e9;
  border-radius: 12rpx;
  margin-bottom: 20rpx;
}

.mood-hint.sad {
  background: #fce4ec;
}

.mood-hint-emoji {
  font-size: 36rpx;
  margin-right: 8rpx;
}

.mood-hint-text {
  font-size: 24rpx;
  color: #666;
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

.remedial-warning {
  font-size: 22rpx;
  color: #e65100;
  margin-top: 16rpx;
  text-align: center;
}

.spell-input-area {
  padding: 8rpx 0;
}

.word-hint {
  text-align: center;
  padding: 16rpx;
  background: #f0f8ff;
  border-radius: 12rpx;
  margin-bottom: 12rpx;
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

/* 点击显示完整单词 */
.word-reveal {
  text-align: center;
  padding: 12rpx;
  margin-bottom: 16rpx;
  font-size: 26rpx;
  color: #999;
  background: #fafafa;
  border-radius: 12rpx;
  border: 1rpx dashed #e0e0e0;
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

/* 补救区域 */
.remedial-section {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20rpx;
  background: #fff3e0;
  border-radius: 16rpx;
  margin-top: 24rpx;
}

.remedial-icon {
  font-size: 36rpx;
  margin-right: 12rpx;
}

.remedial-text {
  font-size: 24rpx;
  color: #e65100;
}

/* 遗弃按钮 */
.abandon-section {
  margin-top: 40rpx;
  display: flex;
  justify-content: center;
}

.abandon-btn {
  background: #fff;
  color: #f44336;
  border: 2rpx solid #ffcdd2;
  border-radius: 40rpx;
  font-size: 26rpx;
  width: 320rpx;
  padding: 16rpx 0;
}

.empty {
  text-align: center;
  padding: 120rpx;
  color: #999;
}
</style>
