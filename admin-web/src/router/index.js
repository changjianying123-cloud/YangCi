import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../layout/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '数据概览' } },
      { path: 'words', name: 'words', component: () => import('../views/Words.vue'), meta: { title: '单词管理' } },
      { path: 'users', name: 'users', component: () => import('../views/Users.vue'), meta: { title: '用户管理' } },
      { path: 'online', name: 'online', component: () => import('../views/Online.vue'), meta: { title: '在线统计' } },
      { path: 'logs', name: 'logs', component: () => import('../views/Logs.vue'), meta: { title: '操作日志' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to) => {
  const token = localStorage.getItem('yangci_admin_token');
  if (!to.meta.public && !token) return { path: '/login' };
  if (to.path === '/login' && token) return { path: '/dashboard' };
  return true;
});

export default router;
