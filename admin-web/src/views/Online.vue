<template>
  <div v-loading="loading">
    <h2 class="page-title">在线统计</h2>

    <div class="toolbar">
      <el-tag type="success" size="large">近 5 分钟活跃用户：{{ users.length }}</el-tag>
      <el-tag type="warning" size="large">进行中房间：{{ rooms.length }}</el-tag>
      <div class="spacer"></div>
      <el-switch v-model="autoRefresh" active-text="自动刷新(10s)" />
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>

    <div class="card-block">
      <h3>活跃用户（近 5 分钟有请求）</h3>
      <el-table :data="users" border stripe size="small">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="nickname" label="昵称" min-width="130" />
        <el-table-column prop="username" label="用户名" width="130">
          <template #default="{ row }">{{ row.username || '-' }}</template>
        </el-table-column>
        <el-table-column label="金币" width="90" align="center">
          <template #default="{ row }">💰 {{ row.coins }}</template>
        </el-table-column>
        <el-table-column prop="cardCount" label="卡牌" width="70" align="center" />
        <el-table-column label="对战" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.inBattle" size="small" type="danger">对战中</el-tag>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="最后活跃" width="170">
          <template #default="{ row }">{{ fmt(row.lastActiveAt) }}</template>
        </el-table-column>
      </el-table>
      <div v-if="!users.length" class="muted" style="padding: 16px 0">当前没有活跃用户</div>
    </div>

    <div class="card-block">
      <h3>进行中的对战房间</h3>
      <el-table :data="rooms" border stripe size="small">
        <el-table-column prop="id" label="房间ID" width="90" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="押注" width="90" align="center">
          <template #default="{ row }">💰 {{ row.bet }}</template>
        </el-table-column>
        <el-table-column label="房主" min-width="140">
          <template #default="{ row }">{{ row.owner?.nickname || '-' }}（#{{ row.owner?.id }}）</template>
        </el-table-column>
        <el-table-column label="对手" min-width="140">
          <template #default="{ row }">
            <span v-if="row.guest">{{ row.guest.nickname }}（#{{ row.guest.id }}）</span>
            <span v-else class="muted">等待中</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!rooms.length" class="muted" style="padding: 16px 0">当前没有进行中的房间</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { dashApi } from '../api';

const loading = ref(false);
const users = ref([]);
const rooms = ref([]);
const autoRefresh = ref(true);
let timer = null;

const STATUS = {
  waiting: { t: 'info', s: '等待加入' },
  ready_check: { t: 'warning', s: '准备中' },
  deploy: { t: 'primary', s: '布阵中' },
  playing: { t: 'danger', s: '对战中' },
  finished: { t: 'success', s: '已结束' },
  cancelled: { t: 'info', s: '已取消' },
};
const statusType = (s) => STATUS[s]?.t || 'info';
const statusText = (s) => STATUS[s]?.s || s;

function fmt(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function load() {
  loading.value = true;
  try {
    const res = await dashApi.online();
    users.value = res.data.users || [];
    rooms.value = res.data.rooms || [];
  } finally {
    loading.value = false;
  }
}

function setupTimer() {
  if (timer) clearInterval(timer);
  if (autoRefresh.value) timer = setInterval(load, 10000);
}
watch(autoRefresh, setupTimer);

onMounted(() => {
  load();
  setupTimer();
});
onUnmounted(() => timer && clearInterval(timer));
</script>
