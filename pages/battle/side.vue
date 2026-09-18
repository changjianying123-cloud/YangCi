<template>
  <view class="side">
    <view class="col-head" :class="{ active: isCurrent }">
      <text class="team-name">{{ teamLabel }}</text>
      <text v-if="isCurrent" class="turn-chip">行动中</text>
      <text class="troop-chip">参战 {{ troopCount }}</text>
      <text v-if="deadUnits.length" class="dead-chip">☠ {{ deadUnits.length }}</text>
    </view>

    <!-- 两列独立的纵向队列：每列自上而下，列内不与其他列互通（出手/阵亡只在列内前移） -->
    <view class="grid" :class="{ 'flip-grid': flip }">
      <view
        v-for="(col, ci) in liveCols"
        :key="'col' + ci"
        class="grid-col"
      >
        <view
          v-for="(cell, ri) in col"
          :key="'c' + ci + '_' + ri"
          class="cell"
          :class="[
            cell.isFront ? 'front' : 'back',
            cell.u && cell.isFront && actableIds.indexOf(cell.u.cardId) >= 0 ? 'actable' : '',
            cell.u && targetIds.indexOf(cell.u.cardId) >= 0 ? 'targetable' : '',
            cell.u && dimId === cell.u.cardId ? 'dim' : '',
          ]"
          @click="cell.u && onTap(cell.u)"
        >
          <UnitCard v-if="cell.u" :u="cell.u" />
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
    // 两列站立顺序（未阵亡）
    standingCols() {
      const side = this.side || {};
      const units = side.units || [];
      const byId = {};
      units.forEach((u) => { byId[u.cardId] = u; });
      const cols = Array.isArray(side.cols) && side.cols.length
        ? side.cols
        : this.fallbackCols(side.queue || []);
      return cols.map((c) => (c || []).map((id) => byId[id]).filter((u) => u && !u.dead));
    },
    deadUnits() {
      return (this.side.units || []).filter((x) => x.dead);
    },
    // 每列可行动的前 N 个
    frontSize() { return 2; },
    // 渲染用：每列自上而下的卡片
    // - 我方：顶对齐（空位在下方）
    // - 敌方(flip)：**底对齐**（空位在上方）+ 列内倒序 —— 让敌军贴着中线，两军对垒
    // 元素形如 { u, isFront }（isFront 按**原始站立序**判定，不受翻转影响）
    liveCols() {
      const MIN_ROWS = 4;
      return this.standingCols.map((col) => {
        const cells = col.map((u, i) => ({ u, isFront: i < this.frontSize }));
        if (this.flip) {
          // 先倒序（最前排靠下 = 贴中线），再在上方补空位 → 底对齐
          cells.reverse();
          while (cells.length < MIN_ROWS) cells.unshift({ u: null, isFront: false });
        } else {
          while (cells.length < MIN_ROWS) cells.push({ u: null, isFront: false });
        }
        return cells;
      });
    },
    revivableIds() {
      return (this.side.units || []).filter((x) => x.dead && !x.usedSkill && !x.revived && !x.spelledOnce).map((x) => x.cardId);
    },
  },
  methods: {
    // 旧存档无 cols：按奇偶位拆两列
    fallbackCols(queue) {
      const a = []; const b = [];
      queue.forEach((id, i) => { (i % 2 === 0 ? a : b).push(id); });
      return [a, b];
    },
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

.grid { display: flex; flex-direction: row; gap: 16rpx; align-items: flex-start; }
/* 敌方（翻转）：列底对齐 → 贴着中线，形成两军对垒交汇感 */
.grid.flip-grid { align-items: flex-end; }
/* 每一列：独立纵向队列（自上而下） */
.grid-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12rpx; }
.cell { width: 100%; min-width: 0; position: relative; display: flex; align-items: center; justify-content: center; border-radius: 14rpx; }
.cell.front { background: rgba(255, 213, 79, .07); }
.cell.back { opacity: .82; }
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
