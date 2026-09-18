<template>
  <view class="side">
    <view class="col-head" :class="{ active: isCurrent }">
      <text class="team-name">{{ teamLabel }}</text>
      <text v-if="isCurrent" class="turn-chip">行动中</text>
      <text class="troop-chip">参战 {{ troopCount }}</text>
      <text v-if="deadUnits.length" class="dead-chip">☠ {{ deadUnits.length }}</text>
    </view>

    <!-- 活着：两列网格，每行 2 个单词。前两行为一线（可行动 / 可被攻击） -->
    <view class="grid">
      <view
        v-for="(row, ri) in liveRows"
        :key="'r' + ri"
        class="grid-row"
        :class="ri === frontRowIndex ? 'front-row' : 'back-row'"
      >
        <view
          v-for="(u, ci) in row"
          :key="'c' + ri + '_' + ci"
          class="cell"
          :class="[
            ri === frontRowIndex ? 'front' : 'back',
            u && ri < 2 && actableIds.indexOf(u.cardId) >= 0 ? 'actable' : '',
            u && targetIds.indexOf(u.cardId) >= 0 ? 'targetable' : '',
            u && dimId === u.cardId ? 'dim' : '',
          ]"
          @click="u && onTap(u)"
        >
          <UnitCard v-if="u" :u="u" />
          <view v-else class="empty-slot">空位</view>
        </view>
      </view>
    </view>

    <!-- 阵亡区：独立的“墓地”列 -->
    <view v-if="deadUnits.length" class="graveyard">
      <text class="gy-label">☠ 阵亡</text>
      <view class="gy-list">
        <view v-for="u in deadUnits" :key="'d' + u.cardId" class="gy-item">
          <UnitCard :u="u" />
          <button
            v-if="reviveActive && revivableIds.indexOf(u.cardId) >= 0"
            class="revive-btn"
            @click.stop="$emit('revive', u)"
          >复活</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import UnitCard from './unit.vue';
export default {
  components: { UnitCard },
  props: {
    side: { type: Object, required: true },
    teamLabel: { type: String, default: '我方' },
    isCurrent: { type: Boolean, default: false },
    targetIds: { type: Array, default: () => [] },
    actableIds: { type: Array, default: () => [] },
    reviveActive: { type: Boolean, default: false },
    dimId: { type: [Number, null], default: null },
    troopCount: { type: Number, default: 0 },
    // 敌方在上方：需要把行序倒过来，让「第一排」靠近中线（面向我方）
    flip: { type: Boolean, default: false },
  },
  computed: {
    standing() {
      return (this.side.queue || [])
        .map((id) => this.side.units.find((x) => x.cardId === id))
        .filter((x) => x && !x.dead);
    },
    deadUnits() {
      return this.side.units.filter((x) => x.dead);
    },
    // 存活单位按队列顺序填充 2×2（前两行），缺的位用 null 占空
    liveRows() {
      const live = this.standing.slice(0, 4);
      const cells = [...live];
      while (cells.length < 4) cells.push(null);
      const rows = [cells.slice(0, 2), cells.slice(2, 4)];
      // 敌方翻转：第一排（活着的队首 2 个）显示在靠下（贴近中线）的那一行
      return this.flip ? [rows[1], rows[0]] : rows;
    },
    // 实际的行是否属于“一线”（前排）：翻转后靠下那行才是前排
    frontRowIndex() {
      return this.flip ? 1 : 0;
    },
    revivableIds() {
      // 与后端 canRevive 一致：阵亡 + 未发动过技能 + 本局未复活过 + 【该单词从来没被拼写过】
      return this.side.units.filter((x) => x.dead && !x.usedSkill && !x.revived && x.neverSpelled === true).map((x) => x.cardId);
    },
  },
  methods: {
    onTap(u) {
      if (u.dead) return; // 阵亡不可行动；复活走独立按钮
      this.$emit('unit-click', u);
    },
  },
};
</script>

<style scoped>
.side { display: flex; flex-direction: column; }
.col-head { display: flex; align-items: center; gap: 10rpx; margin-bottom: 8rpx; padding-left: 4rpx; }
.team-name { font-size: 22rpx; color: #9fb4d0; letter-spacing: 2rpx; }
.col-head.active .team-name { color: #ffd54f; }
.turn-chip { font-size: 18rpx; color: #12243c; background: #ffd54f; border-radius: 18rpx; padding: 2rpx 12rpx; }
.troop-chip { font-size: 18rpx; color: #90caf9; background: #16273d; border-radius: 16rpx; padding: 2rpx 12rpx; margin-left: 6rpx; }

.grid { display: flex; flex-direction: column; gap: 12rpx; }
.grid-row { display: flex; gap: 16rpx; }
.cell { flex: 1; min-width: 0; position: relative; display: flex; align-items: center; justify-content: center; border-radius: 14rpx; }
.grid-row.front-row .cell { background: rgba(255, 213, 79, .07); }
.grid-row.back-row { opacity: .82; }
.cell.actable { box-shadow: 0 0 0 3rpx #ffd54f; animation: breathe 1.4s infinite; border-radius: 14rpx; }
.cell.targetable { box-shadow: 0 0 0 4rpx #ffd54f; animation: pulse 1s infinite; border-radius: 14rpx; }
.cell.dim { opacity: .4; }
.dead-chip { font-size: 18rpx; color: #90a4ae; background: #263238; border-radius: 16rpx; padding: 2rpx 12rpx; margin-left: 6rpx; }

/* 阵亡区（墓地）：独立的横向摆放 */
.graveyard { margin-top: 12rpx; padding: 8rpx 10rpx; border-top: 1rpx dashed #3a4a63; }
.gy-label { font-size: 20rpx; color: #78909c; letter-spacing: 1rpx; }
.gy-list { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 8rpx; }
.gy-item { position: relative; opacity: .62; filter: grayscale(.7); }
@keyframes breathe { 0% { box-shadow: 0 0 0 2rpx rgba(255,213,79,.5); } 50% { box-shadow: 0 0 0 5rpx rgba(255,213,79,.9); } 100% { box-shadow: 0 0 0 2rpx rgba(255,213,79,.5); } }
@keyframes pulse { 0% { box-shadow: 0 0 0 3rpx #ffd54f; } 50% { box-shadow: 0 0 0 8rpx rgba(255,213,79,.5); } 100% { box-shadow: 0 0 0 3rpx #ffd54f; } }
.empty-slot { width: 100%; height: 130rpx; display: flex; align-items: center; justify-content: center; color: #3d5273; font-size: 22rpx; border: 1rpx dashed #2b3d57; border-radius: 12rpx; }
.revive-btn { position: absolute; bottom: -18rpx; left: 50%; transform: translateX(-50%); background: #00c853; color: #fff; font-size: 20rpx; padding: 2rpx 14rpx; border-radius: 20rpx; margin: 0; line-height: 1.7; height: auto; z-index: 5; }
</style>
