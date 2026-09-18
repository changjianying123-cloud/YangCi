<template>
  <div v-loading="loading">
    <h2 class="page-title">数据概览</h2>

    <div class="stat-grid">
      <div class="stat-card blue">
        <div class="label">总用户数</div>
        <div class="value">{{ d.users?.total ?? '-' }}</div>
        <div class="sub">今日新增 {{ d.users?.todayNew ?? 0 }}</div>
      </div>
      <div class="stat-card green">
        <div class="label">实时在线（WS 连接）</div>
        <div class="value">{{ d.online?.wsConnections ?? '-' }}</div>
        <div class="sub">近 5 分钟活跃 {{ d.online?.active5min ?? 0 }}</div>
      </div>
      <div class="stat-card cyan">
        <div class="label">日活（24h）</div>
        <div class="value">{{ d.users?.dau ?? '-' }}</div>
        <div class="sub">DAU</div>
      </div>
      <div class="stat-card purple">
        <div class="label">单词总数</div>
        <div class="value">{{ d.words?.total ?? '-' }}</div>
        <div class="sub">卡牌 {{ d.cards?.total ?? 0 }} 张</div>
      </div>
      <div class="stat-card orange">
        <div class="label">对战总场次</div>
        <div class="value">{{ d.battles?.total ?? '-' }}</div>
        <div class="sub">进行中 {{ d.battles?.ongoing ?? 0 }}</div>
      </div>
      <div class="stat-card red">
        <div class="label">未结束房间</div>
        <div class="value">{{ d.rooms?.open ?? '-' }}</div>
        <div class="sub">对战中 {{ d.rooms?.playing ?? 0 }}</div>
      </div>
    </div>

    <div class="card-block">
      <h3>近 {{ trendDays }} 天新增用户</h3>
      <div class="chart-bars">
        <div v-for="item in trend" :key="item.date" class="chart-bar-col">
          <el-tooltip :content="`${item.date}: 新增 ${item.newUsers}`" placement="top">
            <div class="chart-bar" :style="{ height: barHeight(item.newUsers) }"></div>
          </el-tooltip>
          <span class="chart-bar-label">{{ item.date.slice(5) }}</span>
        </div>
      </div>
      <div v-if="!trend.length" class="muted" style="padding: 20px 0">暂无数据</div>
    </div>

    <div class="toolbar">
      <el-button :icon="Refresh" @click="load" :loading="loading">刷新</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { dashApi } from '../api';

const loading = ref(false);
const d = ref({});
const trend = ref([]);
const trendDays = 14;
let timer = null;

function barHeight(n) {
  const max = Math.max(1, ...trend.value.map((t) => t.newUsers));
  return `${Math.max(2, (n / max) * 100)}%`;
}

async function load() {
  loading.value = true;
  try {
    const [dash, tr] = await Promise.all([dashApi.dashboard(), dashApi.trend(trendDays)]);
    d.value = dash.data || {};
    trend.value = tr.data || [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  // 在线人数每 15s 自动刷新
  timer = setInterval(() => {
    dashApi.dashboard().then((r) => (d.value = r.data || {}));
  }, 15000);
});
onUnmounted(() => timer && clearInterval(timer));
</script>
