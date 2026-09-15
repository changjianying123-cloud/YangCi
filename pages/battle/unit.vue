<template>
  <view class="card" :class="[rim, { shielded: u.shield > 0 }]">
    <view class="head">
      <text class="word">{{ u.word }}</text>
      <text class="role-badge" :class="roleCls">{{ roleText }}</text>
    </view>

    <!-- 屏障：只在真正有屏障时显示（开局全是0层，不必每个词都挂个空屏障） -->
    <view v-if="u.shield > 0" class="barrier">
      <text class="barrier-label">🛡️ 屏障</text>
      <view class="barrier-pips">
        <view v-for="n in u.shield" :key="n" class="pip" />
      </view>
      <text class="barrier-num">×{{ u.shield }}</text>
    </view>

    <view class="foot">
      <text class="lvl">Lv.{{ u.level }}</text>
      <text v-if="u.atkBuff > 0" class="badge atk">⚔️+{{ u.atkBuff }}</text>
      <text v-if="u.dead" class="badge deadb">💀</text>
      <text v-else-if="u.usedSkill" class="badge acted">已出招</text>
    </view>
  </view>
</template>

<script>
const RL = { noun: '名词', adjective: '形容词', verb: '动词', adverb: '副词' };
export default {
  props: {
    u: { type: Object, required: true },
  },
  computed: {
    roleText() { return RL[this.u.role] || this.u.role; },
    roleCls() { return this.u.role; },
    rim() {
      if (this.u.dead) return 'rim-dead';
      if (this.u.role === 'noun') return 'rim-noun';
      if (this.u.role === 'adjective') return 'rim-adj';
      if (this.u.role === 'verb') return 'rim-verb';
      return 'rim-adv';
    },
  },
};
</script>

<style scoped>
.card{ background:#1d2f4a; border:2rpx solid #31445e; border-radius:16rpx; width:100%; max-width:190rpx; padding:8rpx; text-align:center; position:relative; box-sizing:border-box; }
.rim-noun{ border-color:#42a5f5; }
.rim-adj{ border-color:#66bb6a; }
.rim-verb{ border-color:#ef5350; }
.rim-adv{ border-color:#ab47bc; }
.rim-dead{ border-color:#455a64; opacity:.65; }
.card.shielded{ box-shadow: inset 0 0 0 2rpx rgba(121,169,255,.55); }
.head{ display:flex; align-items:center; justify-content:center; gap:6rpx;}
.word{ font-size:24rpx; color:#fff; font-weight:bold; max-width:130rpx; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.role-badge{ font-size:16rpx; color:#fff; padding:1rpx 8rpx; border-radius:8rpx;}
.role-badge.noun{ background:#42a5f5;} .role-badge.adjective{background:#66bb6a;} .role-badge.verb{background:#ef5350;} .role-badge.adverb{background:#ab47bc;}

/* 屏障（取代血条）— 仅在 u.shield > 0 时渲染 */
.barrier{ margin:6rpx 0 4rpx; padding:5rpx 6rpx; border-radius:10rpx; background:#152a47; min-height:46rpx; display:flex; align-items:center; justify-content:center; gap:5rpx; }
.barrier-label{ font-size:16rpx; color:#9fbcff; flex-shrink:0; }
.barrier-pips{ display:flex; gap:3rpx; flex-wrap:wrap; justify-content:center; }
.pip{ width:8rpx; height:16rpx; border-radius:3rpx; background:linear-gradient(180deg,#9fc4ff,#4a7fe0); box-shadow:0 0 6rpx rgba(120,170,255,.9); }
.barrier-num{ font-size:18rpx; color:#cfe0ff; font-weight:bold; flex-shrink:0; }

.foot{ display:flex; align-items:center; justify-content:center; gap:5rpx; flex-wrap:wrap; }
.lvl{ font-size:18rpx; color:#7a93b5; }
.badge{ font-size:16rpx; padding:1rpx 7rpx; border-radius:8rpx; color:#fff;}
.badge.atk{ background:#d32f2f;} .badge.deadb{background:#455a64;} .badge.acted{ background:#37474f; color:#b0bec5;}
</style>
