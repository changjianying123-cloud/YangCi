<template>
  <view class="audio-player" @click="play">
    <text class="icon">{{ playing ? '🔊' : '🔈' }}</text>
    <text class="label">{{ playing ? '播放中...' : label }}</text>
  </view>
</template>

<script>
import { playWordAudio, stopAudio } from '@/utils/audio.js';

export default {
  name: 'AudioPlayer',
  props: {
    src: { type: String, default: '' },
    label: { type: String, default: '播放发音' },
  },
  data() {
    return { playing: false };
  },
  beforeDestroy() {
    stopAudio();
  },
  methods: {
    async play() {
      if (!this.src || this.playing) return;
      this.playing = true;
      try {
        await playWordAudio(this.src);
        this.$emit('played');
      } catch (e) {
        uni.showToast({ title: '播放失败', icon: 'none' });
      } finally {
        this.playing = false;
      }
    },
  },
};
</script>

<style scoped>
.audio-player {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 28rpx;
  background: #eef5ff;
  border-radius: 40rpx;
}

.icon {
  font-size: 32rpx;
}

.label {
  font-size: 26rpx;
  color: #4a90e2;
}
</style>
