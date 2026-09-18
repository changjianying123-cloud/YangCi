<template>
  <div>
    <h2 class="page-title">用户管理</h2>

    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="搜索用户名 / 昵称 / openid / ID"
        clearable
        style="width: 260px"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-select v-model="query.banned" placeholder="全部状态" clearable style="width: 130px" @change="reload">
        <el-option label="正常" :value="'false'" />
        <el-option label="已封禁" :value="'true'" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" border stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="nickname" label="昵称" min-width="130" show-overflow-tooltip />
      <el-table-column prop="username" label="用户名" width="130">
        <template #default="{ row }">
          <span>{{ row.username || '-' }}</span>
          <el-tag v-if="row.isAdmin" size="small" type="warning" style="margin-left: 6px">管理员</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="金币" width="90" align="center">
        <template #default="{ row }">💰 {{ row.coins }}</template>
      </el-table-column>
      <el-table-column prop="cardCount" label="卡牌数" width="80" align="center" />
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.isBanned" size="small" type="danger">已封禁</el-tag>
          <el-tag v-else size="small" type="success">正常</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="近5分钟活跃" width="120" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.recentlyActive" size="small" type="success">在线</el-tag>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="最后活跃" width="170">
        <template #default="{ row }">
          <span class="muted">{{ fmt(row.lastActiveAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="pager"
      layout="total, sizes, prev, pager, next"
      :total="total"
      :page-size="query.pageSize"
      :current-page="query.page"
      :page-sizes="[10, 20, 50, 100]"
      @current-change="onPage"
      @size-change="onSize"
    />

    <!-- 用户详情抽屉 -->
    <el-drawer v-model="drawer.visible" :title="`用户详情 #${detail.id || ''}`" size="480px">
      <div v-if="detail.id" v-loading="detailLoading">
        <div class="detail-head">
          <div class="avatar">{{ (detail.nickname || 'U')[0] }}</div>
          <div>
            <div class="detail-name">{{ detail.nickname }}</div>
            <div class="muted">{{ detail.username || '（无账号）' }} · openid: {{ detail.openid }}</div>
          </div>
        </div>

        <div class="stat-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 16px">
          <div class="stat-card green"><div class="label">健康卡牌</div><div class="value">{{ detail.cards?.healthy }}</div></div>
          <div class="stat-card orange"><div class="label">待喂养</div><div class="value">{{ detail.cards?.incubating }}</div></div>
          <div class="stat-card red"><div class="label">饥饿</div><div class="value">{{ detail.cards?.hungry }}</div></div>
          <div class="stat-card purple"><div class="label">单词蛋</div><div class="value">{{ detail.cards?.eggs }}</div></div>
          <div class="stat-card blue"><div class="label">卡牌总数</div><div class="value">{{ detail.cards?.total }}</div></div>
          <div class="stat-card cyan"><div class="label">对战场次</div><div class="value">{{ detail.battles?.total }}</div></div>
        </div>

        <el-divider />

        <el-form label-width="90px">
          <el-form-item label="昵称">
            <el-input v-model="editForm.nickname" />
          </el-form-item>
          <el-form-item label="金币">
            <el-input-number v-model="editForm.coins" :min="0" :step="10" style="width: 160px" />
            <el-button link type="primary" @click="editForm.coins += 100">+100</el-button>
          </el-form-item>
          <el-form-item label="权限/状态">
            <el-checkbox v-model="editForm.isAdmin">设为管理员</el-checkbox>
            <el-checkbox v-model="editForm.isBanned" style="margin-left: 16px">封禁账号</el-checkbox>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="savingUser" @click="saveUser">保存修改</el-button>
            <el-button @click="openResetPwd">重置密码</el-button>
          </el-form-item>
        </el-form>

        <el-divider />

        <div class="muted">
          注册时间：{{ fmt(detail.createdAt, true) }}<br />
          最后活跃：{{ fmt(detail.lastActiveAt, true) }}<br />
          等级分布：{{ levelText }}
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { userApi } from '../api';

const loading = ref(false);
const rows = ref([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 20, keyword: '', banned: '' });

const drawer = reactive({ visible: false });
const detailLoading = ref(false);
const savingUser = ref(false);
const detail = ref({});
const editForm = reactive({ nickname: '', coins: 0, isAdmin: false, isBanned: false });

const levelText = computed(() => {
  const arr = detail.value.cards?.byLevel || [];
  if (!arr.length) return '暂无';
  return arr.map((x) => `Lv.${x.level} ×${x.count}`).join('，');
});

function fmt(ts, full = false) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return full ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
}

async function load() {
  loading.value = true;
  try {
    const res = await userApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword || undefined,
      banned: query.banned === '' ? undefined : query.banned,
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

async function openDetail(row) {
  drawer.visible = true;
  detailLoading.value = true;
  try {
    const res = await userApi.detail(row.id);
    detail.value = res.data;
    editForm.nickname = res.data.nickname || '';
    editForm.coins = res.data.coins || 0;
    editForm.isAdmin = !!res.data.isAdmin;
    editForm.isBanned = !!res.data.isBanned;
  } finally {
    detailLoading.value = false;
  }
}

async function saveUser() {
  savingUser.value = true;
  try {
    await userApi.update(detail.value.id, {
      nickname: editForm.nickname,
      coins: editForm.coins,
      isAdmin: editForm.isAdmin,
      isBanned: editForm.isBanned,
    });
    ElMessage.success('已保存');
    load();
  } finally {
    savingUser.value = false;
  }
}

async function openResetPwd() {
  try {
    const { value } = await ElMessageBox.prompt('请输入新密码（6-64 位）', '重置密码', {
      inputType: 'password',
      inputValidator: (v) => (v && v.length >= 6 ? true : '密码至少 6 位'),
    });
    await userApi.resetPassword(detail.value.id, value);
    ElMessage.success('密码已重置');
  } catch {
    /* 取消 */
  }
}

onMounted(load);
</script>

<style scoped>
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #409eff;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 600;
}
.detail-name {
  font-size: 17px;
  font-weight: 600;
}
</style>
