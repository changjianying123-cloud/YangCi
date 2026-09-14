<script>
import store from '@/store/index.js';

export default {
  onLaunch() {
    store.ensureLogin();
  },
  onShow() {
    uni.$on('auth:expired', () => {
      // 清除本地登录态即可；页面重定向由 request.js 统一处理
      store.logout();
    });
  },
};
</script>

<style lang="scss">
@import '@/style/index.scss';

/* 全局统一盒模型，避免 padding/border 撑破宽度（App/小程序/ H5 跨端稳定） */
view,
text,
button,
image,
scroll-view,
swiper {
  box-sizing: border-box;
}

page {
  background-color: #f7f8fa;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
}
</style>
