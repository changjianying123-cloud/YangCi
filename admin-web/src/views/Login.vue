<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="brand">
        <div class="brand-icon">📚</div>
        <h1>养词 · 后台管理</h1>
        <p class="muted">请使用管理员账号登录</p>
      </div>
      <el-form :model="form" @submit.prevent="onSubmit" size="large">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" :prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-button type="primary" class="login-btn" :loading="loading" @click="onSubmit">
          登录
        </el-button>
      </el-form>
      <div class="tip">
        <span class="muted">还没有管理员？</span>
        <el-button text type="primary" size="small" @click="onBootstrap">用当前账号初始化为管理员</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { User, Lock } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../store/auth';
import { authApi } from '../api';

const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const form = reactive({ username: '', password: '' });

async function onSubmit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    const user = await auth.login(form.username, form.password);

    // 已具管理员权限：直接进后台
    if (user?.isAdmin) {
      ElMessage.success('登录成功');
      router.replace('/dashboard');
      return;
    }

    // 还不是管理员：仅当库里一个管理员都没有时，bootstrap 才会成功
    try {
      await authApi.bootstrap();
      await auth.refreshProfile();
      ElMessage.success('已初始化为管理员');
      router.replace('/dashboard');
      return;
    } catch {
      // 已有管理员 —— 说明这个账号确实没权限。
      // 注意：不能在这里 logout，否则会遮蔽真正的“无权限”提示；
      // 且 refreshProfile 能拿到最新 isAdmin，避免字段滞后误判。
      try {
        const fresh = await auth.refreshProfile();
        if (fresh?.isAdmin) {
          ElMessage.success('登录成功');
          router.replace('/dashboard');
          return;
        }
      } catch {
        /* 忽略：以最终提示为准 */
      }
      auth.logout();
      ElMessage.error('该账号不是管理员，请使用管理员账号登录');
    }
  } catch {
    /* 登录本身的错误提示由拦截器处理 */
  } finally {
    loading.value = false;
  }
}

async function onBootstrap() {
  ElMessage.info('用要提权的账号在下方正常登录即可。仅当系统还没有任何管理员时，登录会自动完成提权；否则请让现有管理员在「用户管理」里为你开启权限。');
}
</script>

<style scoped>
.login-wrap {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1f2d3d 0%, #409eff 100%);
}
.login-card {
  width: 380px;
  background: #fff;
  border-radius: 14px;
  padding: 36px 32px 24px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.brand {
  text-align: center;
  margin-bottom: 24px;
}
.brand-icon {
  font-size: 42px;
}
.brand h1 {
  font-size: 20px;
  margin: 10px 0 6px;
}
.login-btn {
  width: 100%;
  margin-top: 4px;
}
.tip {
  margin-top: 16px;
  text-align: center;
}
</style>
