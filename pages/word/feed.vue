<template>
  <view class="page">
    <!-- 顶部金币栏 -->
    <view class="coin-bar">
      <text class="coin-display">💰 {{ card.coins || 0 }}</text>
      <text class="coin-hint" v-if="card.canFeed && card.feedCoinReward > 0 && !card.isHungry && !card.hadWrongBefore">喂养成功可得 +{{ card.feedCoinReward }} 💰</text>
      <text class="coin-hint" v-else-if="card.canFeed && card.isHungry">饥饿喂养无金币奖励</text>
    </view>

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
          <!-- 拼写检测模式：只显示释义 -->
          <view v-if="card.canFeed" class="challenge-mode">
            <text class="challenge-label">✏️ 拼写检测</text>
            <text class="challenge-meaning">{{ card.meaning }}</text>
            <text class="challenge-hint">根据中文释义拼写出英文</text>
            <view v-if="card.feedCoinReward > 0 && !card.isHungry && !card.challengeHadWrong" class="coin-reward-hint">
              <text>💎 拼写正确可得 {{ card.feedCoinReward }} 💰</text>
            </view>
            <view v-else-if="card.challengeHadWrong" class="coin-reward-hint penalty">
              <text>⚠️ 之前拼写错误扣了金币，需要重新拼对 {{ spellRequired - spellCount }} 次</text>
            </view>
            <view v-else-if="card.isHungry" class="coin-reward-hint no-reward">
              <text>⚠️ 饥饿状态喂养无金币奖励</text>
            </view>

            <!-- 拼写进度：倒着数 3 → 2 → 1 -->
            <view v-if="card.challengeHadWrong" class="challenge-progress">
              <text>补考拼写：还需拼对 {{ spellRequired - spellCount }} 次（{{ spellCount }} / {{ spellRequired }}）</text>
            </view>
            <view v-else class="challenge-progress">
              <text>还需拼对 {{ spellRequired - spellCount }} 次可确认喂养（{{ spellCount }} / {{ spellRequired }}）</text>
            </view>

            <SpellInput
              v-model="spellValue"
              :disabled="submitting"
              :focus="inputFocused"
              button-text="提交拼写"
              @submit="submitSpell"
            />

            <view class="challenge-reveal" @click="showFullWord = !showFullWord">
              <text>{{ showFullWord ? card.word : '👆 忘记单词了？点击查看' }}</text>
            </view>

            <view class="mn-entry" @click="openMnemonics">
              <text v-if="card.mnemonicCount > 0">💡 记不住？看看助记（{{ card.mnemonicCount }}）</text>
              <text v-else>💡 记不住？添加助记 / 看助记</text>
            </view>
          </view>

          <!-- 不可喂养时显示 -->
          <view v-else>
            <text class="word-text">{{ card.word }}</text>
            <text class="meaning">{{ card.meaning }}</text>
            <text class="phonetic" v-if="card.phonetic">{{ card.phonetic }}</text>
            <AudioPlayer :src="card.audioUrl" label="听发音" />
            <view class="mn-entry" @click="openMnemonics">
              <text v-if="card.mnemonicCount > 0">💡 查看助记（{{ card.mnemonicCount }}）</text>
              <text v-else>💡 添加助记 / 看助记</text>
            </view>
            <view class="feed-info">
              <text class="deadline">{{ card.nextFeedIn }}</text>
              <text v-if="card.hasRemedialWindow" class="remedial-badge">🔄 补救喂养窗口</text>
              <text v-if="!card.canFeed && !card.isHungry" class="window-closed">⏳ 未到喂养时间</text>
            </view>
          </view>
        </view>

        <!-- 饥饿恢复区 -->
        <view v-if="card.isHungry && !card.canFeed" class="hunger-recover-section">
          <view class="hunger-icon">😰</view>
          <text class="hunger-title">单词饥饿中！</text>
          <text class="hunger-desc">消耗 10 💰 可立即恢复并开始喂养</text>
          <button
            class="recover-btn"
            :disabled="recovering || (card.coins || 0) < 10"
            @click="doRecoverHunger"
          >
            {{ recovering ? '恢复中...' : `提供 10 💰 恢复饥饿` }}
          </button>
          <text v-if="(card.coins || 0) < 10" class="coin-insufficient">💰 金币不足，去收服新单词获取金币吧</text>
        </view>

        <!-- 不可喂养时显示提示 -->
        <view v-if="!card.canFeed && !card.isHungry" class="no-feed-tip">
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

    <!-- 助记面板 -->
    <MnemonicPanel
      :visible="mnVisible"
      :word-id="card.wordId"
      :word="card.word"
      @close="mnVisible = false"
      @changed="onMnemonicChanged"
    />
  </view>
</template>

<script>
import { getCardDetail, feedCard, hatchEgg, abandonCard, recoverHunger } from '@/api/card.js';
import SpellInput from '@/components/SpellInput/SpellInput.vue';
import AudioPlayer from '@/components/AudioPlayer/AudioPlayer.vue';
import MnemonicPanel from '@/components/MnemonicPanel/MnemonicPanel.vue';
import { cardStatusText, cardStatusColor, levelLabel, moodSymbol } from '@/utils/common.js';
import store from '@/store/index.js';

export default {
  components: { SpellInput, AudioPlayer, MnemonicPanel },
  data() {
    return {
      cardId: null,
      card: {},
      spellValue: '',
      spellCount: 0,
      spellRequired: 3,
      submitting: false,
      hatching: false,
      recovering: false,
      showFullWord: false,
      // 输入框是否保持聚焦：提交后重新置 true，方便连续拼写
      inputFocused: true,
      // 本轮是否已拼满（拼满后要离开页面，不再抢焦点）
      roundDone: false,
      // 助记面板
      mnVisible: false,
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
    openMnemonics() {
      if (!this.card.wordId) return;
      this.mnVisible = true;
    },
    onMnemonicChanged(list) {
      this.card.mnemonicCount = Array.isArray(list) ? list.length : 0;
    },
    async loadCard() {
      const res = await getCardDetail(this.cardId);
      if (res.data) {
        this.card = res.data;
        this.spellCount = res.data.feedSpellCount || 0;
        this.spellRequired = res.data.feedSpellRequired || 3;
        this.roundDone = false; // 重新载入卡片则开启新一轮

        // 判断是否之前拼写过（hadWrongAfterReset 等信息）
        // 直接从后端的 had_wrong_attempt 判断
        this.card.challengeHadWrong = res.data.mood === 'sad';
      }
    },
    // 消耗金币恢复饥饿
    async doRecoverHunger() {
      if (this.recovering) return;
      if ((this.card.coins || 0) < 10) {
        uni.showToast({ title: '💰 金币不足，需要10金币', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '恢复饥饿',
        content: `消耗 10 💰 恢复「${this.card.word}」的饥饿状态？恢复后即可开始拼写喂养，还需拼对 3 次才算喂养成功。`,
        success: async (modalRes) => {
          if (!modalRes.confirm) return;
          this.recovering = true;
          try {
            const res = await recoverHunger(this.cardId);
            if (res.data) {
              const left = res.data.remaining != null ? res.data.remaining : 3;
              uni.showToast({
                title: `恢复成功！还需拼对 ${left} 次`,
                icon: 'none',
                duration: 2000,
              });
              // 刷新后进度应保持原样（恢复不推进拼写计数）
              await this.loadCard();
              await store.fetchCards(true);
            }
          } catch (e) {
            uni.showToast({ title: e.errMsg || '恢复失败', icon: 'none' });
          } finally {
            this.recovering = false;
          }
        },
      });
    },
    /**
     * 让输入框重新获得焦点
     * 先置 false 再置 true，确保 prop 真的发生变化（否则小程序不会重新弹键盘）
     */
    refocusInput() {
      this.inputFocused = false;
      this.$nextTick(() => {
        this.inputFocused = true;
      });
    },
    async submitSpell() {
      if (this.submitting || !this.spellValue.trim()) return;
      this.submitting = true;
      this.showFullWord = false;

      const ok = this.spellValue.trim().toLowerCase() === (this.card.word || '').toLowerCase();
      this.spellValue = '';
      try {
        const res = await feedCard(this.cardId, { spell_correct: ok });

        if (!ok) {
          // 拼写错误
          this.spellCount = 0;
          this.spellRequired = 3;
          const penaltyMsg = res.data && res.data.coinPenalty > 0 ? `扣除 ${res.data.coinPenalty} 💰` : '';
          uni.showToast({ title: `拼写错误${penaltyMsg ? '，' + penaltyMsg : ''}，再试一次`, icon: 'none' });
          await this.loadCard();
          return;
        }

        // 拼写正确
        if (res.data) {
          this.spellCount = res.data.count || 0;
          this.spellRequired = res.data.required || 3;

          if (res.data.done) {
            this.roundDone = true; // 已拼满，即将返回，不再重新聚焦
            const coinMsg = res.data.coinReward > 0 ? ` +${res.data.coinReward}💰` : '';
            const hasRemedial = res.data.hasRemedial ? ' 需2小时后补救' : '';
            uni.showToast({ title: `喂养成功！${coinMsg}${hasRemedial}`, icon: 'success' });
            await store.fetchCards(true);
            setTimeout(() => uni.navigateBack(), 1200);
          } else {
            const coinMsg = res.data.coinReward > 0 ? ` +${res.data.coinReward}💰` : '';
            const left = res.data.remaining != null ? res.data.remaining : (res.data.required - res.data.count);
            uni.showToast({ title: `拼写正确！还需 ${left} 次${coinMsg}`, icon: 'none' });
            await this.loadCard();
          }
        }
      } catch (e) {
        uni.showToast({ title: e.errMsg || '操作失败', icon: 'none' });
      } finally {
        this.submitting = false;
        // ⚠️ 解除 submitting 后再聚焦：输入框 :disabled="submitting"，
        // 禁用状态下无法获得焦点，提前调用会被默默丢掉。
        // 本轮已拼满（roundDone）时即将返回，不再聚焦以免键盘闪烁。
        if (!this.roundDone) this.refocusInput();
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
  font-size: 24rpx;
  color: #6d4c41;
}

.coin-hint.hungry {
  color: #d32f2f;
}

/* 心情状态栏 */
.mood-status-bar {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 16rpx 20rpx;
  border-radius: 16rpx;
  margin-bottom: 16rpx;
  color: #fff;
}

.mood-emoji {
  font-size: 36rpx;
}

.status-tag {
  font-size: 24rpx;
}

/* 单词面板 */
.word-panel {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;
}

/* 拼写检测模式（可喂养时） */
.challenge-mode {
  text-align: center;
}

.challenge-label {
  display: block;
  font-size: 22rpx;
  color: #fff;
  background: #4a90e2;
  padding: 4rpx 20rpx;
  border-radius: 20rpx;
  width: 140rpx;
  margin: 0 auto 24rpx;
}

.challenge-meaning {
  display: block;
  font-size: 40rpx;
  font-weight: bold;
  margin-bottom: 8rpx;
}

.challenge-hint {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 16rpx;
}

.challenge-progress {
  font-size: 26rpx;
  color: #4a90e2;
  margin-bottom: 16rpx;
}

.challenge-reveal {
  font-size: 22rpx;
  color: #999;
  padding: 12rpx;
  margin-top: 16rpx;
  background: #f5f5f5;
  border-radius: 12rpx;
}

/* 助记入口 */
.mn-entry {
  display: inline-block;
  margin-top: 16rpx;
  padding: 10rpx 28rpx;
  background: #fff8e1;
  border: 2rpx solid #ffe082;
  border-radius: 32rpx;
}

.mn-entry text {
  font-size: 24rpx;
  color: #e65100;
  font-weight: bold;
}

/* 金币提示 */
.coin-reward-hint {
  padding: 10rpx;
  background: #fff8e1;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
}

.coin-reward-hint text {
  font-size: 24rpx;
  color: #e65100;
}

.coin-reward-hint.penalty {
  background: #fce4ec;
}

.coin-reward-hint.penalty text {
  color: #c62828;
}

.coin-reward-hint.no-reward {
  background: #fce4ec;
}

.coin-reward-hint.no-reward text {
  color: #c62828;
}

/* 不可喂养时显示单词信息 */
.word-text {
  display: block;
  font-size: 44rpx;
  font-weight: bold;
  margin-bottom: 8rpx;
}

.meaning {
  display: block;
  font-size: 28rpx;
  color: #666;
  margin-bottom: 4rpx;
}

.phonetic {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 16rpx;
}

.feed-info {
  margin-top: 16rpx;
}

.deadline {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 4rpx;
}

.remedial-badge {
  display: block;
  font-size: 22rpx;
  color: #2196f3;
  font-weight: bold;
  margin-bottom: 4rpx;
}

.window-closed {
  display: block;
  font-size: 24rpx;
  color: #999;
}

/* 饥饿恢复区 */
.hunger-recover-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx;
  background: #fff;
  border-radius: 20rpx;
  margin-bottom: 24rpx;
  border: 2rpx solid #ffcdd2;
}

.hunger-icon {
  font-size: 80rpx;
  margin-bottom: 16rpx;
}

.hunger-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #d32f2f;
  margin-bottom: 8rpx;
}

.hunger-desc {
  font-size: 26rpx;
  color: #999;
  margin-bottom: 32rpx;
}

.recover-btn {
  background: linear-gradient(135deg, #ff9800, #f57c00);
  color: #fff;
  border-radius: 48rpx;
  width: 400rpx;
  font-size: 30rpx;
  font-weight: bold;
}

.coin-insufficient {
  font-size: 24rpx;
  color: #e53935;
  margin-top: 16rpx;
}

/* 不可喂养 */
.no-feed-tip {
  text-align: center;
  padding: 48rpx;
  background: #fff;
  border-radius: 20rpx;
  margin-bottom: 24rpx;
}

.tip-icon {
  display: block;
  font-size: 64rpx;
  margin-bottom: 16rpx;
}

.tip-text {
  display: block;
  font-size: 28rpx;
  color: #333;
  margin-bottom: 8rpx;
}

.tip-sub {
  display: block;
  font-size: 24rpx;
  color: #999;
}

/* 补救 */
.remedial-section {
  display: flex;
  align-items: center;
  padding: 20rpx;
  background: #e3f2fd;
  border-radius: 12rpx;
  margin-bottom: 24rpx;
}

.remedial-icon {
  font-size: 28rpx;
  margin-right: 8rpx;
}

.remedial-text {
  font-size: 24rpx;
  color: #1565c0;
}

/* 遗弃 */
.abandon-section {
  text-align: center;
  margin-top: 32rpx;
}

.abandon-btn {
  background: transparent;
  border: 2rpx solid #e53935;
  color: #e53935;
  border-radius: 48rpx;
  width: 300rpx;
  font-size: 26rpx;
}
</style>
