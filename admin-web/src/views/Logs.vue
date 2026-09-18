<template>
  <div>
    <h2 class="page-title">操作日志</h2>

    <div class="toolbar">
      <el-select v-model="query.action" placeholder="全部操作" clearable style="width: 200px" @change="reload">
        <el-option v-for="a in actions" :key="a.value" :label="a.label" :value="a.value" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <div class="spacer"></div>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" border stripe size="small">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="时间" width="180">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="adminName" label="操作人" width="140" />
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-tag size="small">{{ actionText(row.action) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="对象" width="140">
        <template #default="{ row }">{{ row.targetType }} #{{ row.targetId ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="详情" min-width="260">
        <template #default="{ row }">
          <span class="muted">{{ row.detail || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="ip" label="IP" width="130" />
    </el-table>

    <el-pagination
      class="pager"
      layout="total, sizes, prev, pager, next"
      :total="total"
      :page-size="query.pageSize"
      :current-page="query.page"
      :page-sizes="[20, 50, 100]"
      @current-change="onPage"
      @size-change="onSize"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { Search, Refresh } from '@element-plus/icons-vue';
import { logApi } from '../api';

const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 20, action: '' });

const actions = [
  { label: '新增单词', value: 'word.create' },
  { label: '编辑单词', value: 'word.update' },
  { label: '删除单词', value: 'word.delete' },
  { label: '编辑用户', value: 'user.update' },
  { label: '重置密码', value: 'user.reset_password' },
  { label: '管理员初始化', value: 'admin.bootstrap' },
];

const ACTION_TEXT = Object.fromEntries(actions.map((a) => [a.value, a.label]));
const actionText = (a) => ACTION_TEXT[a] || a;

function fmt(ts) {
  if (ts === null || ts === undefined || ts === '') return '-';
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (!Number.isFinite(ms)) return '-';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function load() {
  loading.value = true;
  try {
    const res = await logApi.list({
      page: query.page,
      pageSize: query.pageSize,
      action: query.action || undefined,
    });
    rows.value = res.data.items || [];
    total.value = res.data.total || 0;
  } finally {
    loading.value = false;
  }
}
function reload() {
  query.page = 1;
  load();
}
function onPage(p) {
  query.page = p;
  load();
}
function onSize(s) {
  query.pageSize = s;
  query.page = 1;
  load();
}

onMounted(load);
</script>

<style scoped>
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
