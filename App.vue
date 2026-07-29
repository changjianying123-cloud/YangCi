<script>
import store from '@/store/index.js';

export default {
  onLaunch() {
    store.ensureLogin().catch(() => {
      console.warn('自动登录失败，将在进入页面时重试');
    });
  },
  onShow() {
    uni.$on('auth:expired', () => {
      store.logout();
      store.ensureLogin();
    });
  },
};
</script>

<style lang="scss">
@import '@/style/index.scss';

page {
  background-color: #f7f8fa;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
}
</style>
