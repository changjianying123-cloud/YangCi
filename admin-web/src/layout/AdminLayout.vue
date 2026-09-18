<template>
  <el-container class="layout">
    <el-aside width="210px" class="aside">
      <div class="logo">
        <span class="logo-icon">📚</span>
        <span class="logo-text">养词后台</span>
      </div>
      <el-menu :default-active="activeMenu" router class="menu">
        <el-menu-item index="/dashboard">
          <el-icon><DataLine /></el-icon><span>数据概览</span>
        </el-menu-item>
        <el-menu-item index="/words">
          <el-icon><Notebook /></el-icon><span>单词管理</span>
        </el-menu-item>
        <el-menu-item index="/users">
          <el-icon><User /></el-icon><span>用户管理</span>
        </el-menu-item>
        <el-menu-item index="/online">
          <el-icon><Connection /></el-icon><span>在线统计</span>
        </el-menu-item>
        <el-menu-item index="/logs">
          <el-icon><Document /></el-icon><span>操作日志</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-title">{{ currentTitle }}</div>
        <div class="header-right">
          <span class="who">{{ auth.user?.nickname || auth.user?.username || '管理员' }}</span>
          <el-button text @click="onLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox, ElMessage } from 'element-plus';
import { useAuthStore } from '../store/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const activeMenu = computed(() => route.path);
const currentTitle = computed(() => route.meta?.title || '养词后台');

async function onLogout() {
  try {
    await ElMessageBox.confirm('确定退出登录吗？', '提示', { type: 'warning' });
  } catch {
    return;
  }
  auth.logout();
  ElMessage.success('已退出');
  router.replace('/login');
}
</script>

<style scoped>
.layout {
  height: 100vh;
}
.aside {
  background: #1f2d3d;
  overflow-y: auto;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.logo-icon {
  font-size: 20px;
}
.menu {
  border-right: none;
  background: transparent;
  --el-menu-bg-color: transparent;
  --el-menu-text-color: #c0c4cc;
  --el-menu-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-menu-active-color: #409eff;
}
.header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e4e7ed;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.who {
  color: #606266;
  font-size: 14px;
}
.main {
  background: #f5f7fa;
  padding: 20px;
  overflow-y: auto;
}
</style>
