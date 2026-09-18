<template>
  <view class="mn-mask" v-if="visible" @click="close">
    <view class="mn-panel" @click.stop>
      <!-- 头部 -->
      <view class="mn-header">
        <view class="mn-header-left">
          <text class="mn-word">{{ word }}</text>
          <text class="mn-sub">助记 · {{ list.length }} 条</text>
        </view>
        <text class="mn-close" @click="close">✕</text>
      </view>

      <!-- 内容区 -->
      <scroll-view class="mn-body" scroll-y>
        <view v-if="loading" class="mn-loading">
          <text>加载中…</text>
        </view>

        <view v-else-if="!list.length" class="mn-empty">
          <text class="mn-empty-icon">💡</text>
          <text class="mn-empty-text">还没有助记</text>
          <text class="mn-empty-sub">来发布第一条，帮其他同学记住这个词</text>
        </view>

        <view v-else>
          <view v-for="m in list" :key="m.id" class="mn-item" :class="{ official: m.isOfficial }">
            <view class="mn-item-head">
              <view class="mn-badge-wrap">
                <text v-if="m.isOfficial" class="mn-badge official-badge">官方</text>
                <text v-else class="mn-badge user-badge">{{ m.authorName || '同学' }}</text>
              </view>
              <text v-if="m.title" class="mn-item-title">{{ m.title }}</text>
            </view>

            <image
              v-if="m.imageUrl"
              class="mn-image"
              :src="abs(m.imageUrl)"
              mode="widthFix"
              @click="previewImage(m.imageUrl)"
            />

            <text v-if="m.content" class="mn-content">{{ m.content }}</text>

            <view class="mn-item-foot">
              <view class="mn-like" :class="{ liked: m.liked }" @click="onLike(m)">
                <text>{{ m.liked ? '❤️' : '🤍' }} {{ m.likeCount }}</text>
              </view>
              <view class="mn-item-actions" v-if="m.isMine">
                <text class="mn-action" @click="openEdit(m)">编辑</text>
                <text class="mn-action danger" @click="onDelete(m)">删除</text>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>

      <!-- 底部：发布入口 -->
      <view class="mn-footer">
        <button class="mn-publish-btn" @click="openCreate">✏️ 我要发布助记</button>
      </view>
    </view>

    <!-- 发布/编辑 弹窗 -->
    <view class="mn-form-mask" v-if="formVisible" @click="closeForm">
      <view class="mn-form" @click.stop>
        <text class="mn-form-title">{{ form.id ? '编辑助记' : '发布助记' }}</text>

        <view class="mn-field">
          <text class="mn-label">标题（可选）</text>
          <input class="mn-input" v-model="form.title" placeholder="比如：谐音法 / 图像联想" maxlength="50" />
        </view>

        <view class="mn-field">
          <text class="mn-label">助记内容</text>
          <textarea
            class="mn-textarea"
            v-model="form.content"
            placeholder="写下你的记忆技巧，帮同学记住这个单词…"
            maxlength="2000"
            :auto-height="true"
          />
          <text class="mn-counter">{{ form.content.length }}/2000</text>
        </view>

        <view class="mn-field">
          <text class="mn-label">图片（可选）</text>
          <view class="mn-img-row">
            <view v-if="form.imageUrl" class="mn-img-preview">
              <image :src="abs(form.imageUrl)" mode="aspectFill" @click="previewImage(form.imageUrl)" />
              <text class="mn-img-remove" @click="form.imageUrl = ''">✕</text>
            </view>
            <view class="mn-img-pick" @click="chooseImage">
              <text class="mn-img-pick-icon">＋</text>
              <text class="mn-img-pick-text">{{ form.imageUrl ? '换图' : '选图' }}</text>
            </view>
          </view>
        </view>

        <view class="mn-form-btns">
          <button class="mn-btn ghost" @click="closeForm">取消</button>
          <button class="mn-btn primary" :disabled="submitting" @click="submitForm">
            {{ submitting ? '提交中…' : '发布' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import {
  listMnemonics,
  createMnemonic,
  updateMnemonic,
  deleteMnemonic,
  toggleMnemonicLike,
} from '@/api/mnemonic.js';
import { uploadImage } from '@/api/upload.js';
import { toAbsoluteUrl } from '@/utils/request.js';

export default {
  name: 'MnemonicPanel',
  props: {
    visible: { type: Boolean, default: false },
    wordId: { type: [Number, String], default: null },
    word: { type: String, default: '' },
    // 外部已预加载的数据（可为空，为空则自行请求）
    preloaded: { type: Array, default: null },
  },
  data() {
    return {
      list: [],
      loading: false,
      submitting: false,
      formVisible: false,
      form: { id: null, title: '', content: '', imageUrl: '' },
    };
  },
  watch: {
    visible(v) {
      if (v) this.load();
    },
  },
  methods: {
    // 把 /uploads/xx 转成绝对地址给 <image> 用
    abs(url) {
      return toAbsoluteUrl(url);
    },
    async load() {
      if (this.preloaded) {
        this.list = this.preloaded;
        return;
      }
      if (!this.wordId) return;
      this.loading = true;
      try {
        const res = await listMnemonics(this.wordId);
        this.list = res.data || [];
      } catch (e) {
        uni.showToast({ title: '助记加载失败', icon: 'none' });
      } finally {
        this.loading = false;
      }
    },
    close() {
      this.formVisible = false;
      this.$emit('close');
    },
    previewImage(url) {
      uni.previewImage({ urls: [this.abs(url)] });
    },
    async onLike(m) {
      try {
        const res = await toggleMnemonicLike(m.id);
        m.liked = res.data.liked;
        m.likeCount = res.data.likeCount;
      } catch (e) {
        uni.showToast({ title: '操作失败', icon: 'none' });
      }
    },
    openCreate() {
      this.form = { id: null, title: '', content: '', imageUrl: '' };
      this.formVisible = true;
    },
    openEdit(m) {
      this.form = {
        id: m.id,
        title: m.title || '',
        content: m.content || '',
        imageUrl: m.imageUrl || '',
      };
      this.formVisible = true;
    },
    closeForm() {
      this.formVisible = false;
    },
    chooseImage() {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        success: async (res) => {
          const path = res.tempFilePaths && res.tempFilePaths[0];
          if (!path) return;
          uni.showLoading({ title: '上传中…' });
          try {
            const up = await uploadImage(path);
            this.form.imageUrl = (up && up.data && up.data.url) || '';
          } catch (e) {
            uni.showToast({ title: '图片上传失败', icon: 'none' });
          } finally {
            uni.hideLoading();
          }
        },
      });
    },
    async submitForm() {
      if (this.submitting) return;
      const content = (this.form.content || '').trim();
      const imageUrl = (this.form.imageUrl || '').trim();
      if (!content && !imageUrl) {
        uni.showToast({ title: '内容和图片至少填一项', icon: 'none' });
        return;
      }
      this.submitting = true;
      try {
        if (this.form.id) {
          await updateMnemonic(this.form.id, {
            title: this.form.title || null,
            content: content || null,
            imageUrl: imageUrl || null,
          });
          uni.showToast({ title: '已保存', icon: 'success' });
        } else {
          await createMnemonic(this.wordId, {
            title: this.form.title || null,
            content: content || null,
            imageUrl: imageUrl || null,
          });
          uni.showToast({ title: '发布成功', icon: 'success' });
        }
        this.formVisible = false;
        this.preloadedLoaded = false;
        // 重新拉取（此时不能再走 preloaded 缓存）
        this.loading = true;
        const res = await listMnemonics(this.wordId);
        this.list = res.data || [];
        this.$emit('changed', this.list);
      } catch (e) {
        uni.showToast({ title: e.msg || '提交失败', icon: 'none' });
      } finally {
        this.loading = false;
        this.submitting = false;
      }
    },
    onDelete(m) {
      uni.showModal({
        title: '删除助记',
        content: '确定删除这条助记吗？删除后不可恢复。',
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await deleteMnemonic(m.id);
            uni.showToast({ title: '已删除', icon: 'success' });
            this.list = this.list.filter((x) => x.id !== m.id);
            this.$emit('changed', this.list);
          } catch (e) {
            uni.showToast({ title: '删除失败', icon: 'none' });
          }
        },
      });
    },
  },
};
</script>

<style scoped>
.mn-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
  display: flex;
  align-items: flex-end;
}

.mn-panel {
  width: 100%;
  max-height: 82vh;
  background: #fff;
  border-radius: 32rpx 32rpx 0 0;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
}

.mn-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32rpx 32rpx 16rpx;
  border-bottom: 2rpx solid #f0f0f0;
}

.mn-header-left {
  display: flex;
  flex-direction: column;
}

.mn-word {
  font-size: 36rpx;
  font-weight: bold;
  color: #222;
}

.mn-sub {
  font-size: 22rpx;
  color: #999;
  margin-top: 4rpx;
}

.mn-close {
  font-size: 36rpx;
  color: #999;
  padding: 8rpx 16rpx;
}

.mn-body {
  flex: 1;
  max-height: 58vh;
  padding: 16rpx 24rpx;
  box-sizing: border-box;
}

.mn-loading,
.mn-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 40rpx;
  color: #999;
}

.mn-empty-icon {
  font-size: 72rpx;
  margin-bottom: 16rpx;
}

.mn-empty-text {
  font-size: 30rpx;
  color: #666;
  margin-bottom: 8rpx;
}

.mn-empty-sub {
  font-size: 24rpx;
  color: #bbb;
  text-align: center;
}

.mn-item {
  background: #f7f8fa;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
  border-left: 8rpx solid #ddd;
}

.mn-item.official {
  border-left-color: #4a90e2;
  background: #f2f7ff;
}

.mn-item-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 12rpx;
  flex-wrap: wrap;
}

.mn-badge {
  font-size: 20rpx;
  padding: 4rpx 14rpx;
  border-radius: 20rpx;
  font-weight: bold;
}

.official-badge {
  background: #4a90e2;
  color: #fff;
}

.user-badge {
  background: #e8f5e9;
  color: #43a047;
}

.mn-item-title {
  font-size: 26rpx;
  color: #333;
  font-weight: bold;
}

.mn-image {
  width: 100%;
  border-radius: 12rpx;
  margin-bottom: 12rpx;
}

.mn-content {
  display: block;
  font-size: 28rpx;
  color: #333;
  line-height: 1.6;
  margin-bottom: 12rpx;
  word-break: break-all;
}

.mn-item-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mn-like {
  font-size: 26rpx;
  color: #666;
  padding: 6rpx 16rpx;
  border-radius: 24rpx;
  background: #fff;
}

.mn-like.liked {
  color: #e53935;
}

.mn-item-actions {
  display: flex;
  gap: 24rpx;
}

.mn-action {
  font-size: 24rpx;
  color: #4a90e2;
}

.mn-action.danger {
  color: #e53935;
}

.mn-footer {
  padding: 16rpx 24rpx 24rpx;
  border-top: 2rpx solid #f0f0f0;
}

.mn-publish-btn {
  background: linear-gradient(135deg, #4a90e2, #357abd);
  color: #fff;
  border-radius: 44rpx;
  font-size: 28rpx;
  font-weight: bold;
}

/* 发布/编辑弹窗 */
.mn-form-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mn-form {
  width: 640rpx;
  max-height: 80vh;
  background: #fff;
  border-radius: 24rpx;
  padding: 36rpx 32rpx;
  box-sizing: border-box;
  overflow-y: auto;
}

.mn-form-title {
  display: block;
  font-size: 34rpx;
  font-weight: bold;
  text-align: center;
  margin-bottom: 28rpx;
}

.mn-field {
  margin-bottom: 24rpx;
}

.mn-label {
  display: block;
  font-size: 26rpx;
  color: #666;
  margin-bottom: 10rpx;
}

.mn-input {
  width: 100%;
  height: 72rpx;
  background: #f5f6f8;
  border-radius: 12rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}

.mn-textarea {
  width: 100%;
  min-height: 180rpx;
  background: #f5f6f8;
  border-radius: 12rpx;
  padding: 20rpx;
  font-size: 28rpx;
  box-sizing: border-box;
}

.mn-counter {
  display: block;
  text-align: right;
  font-size: 22rpx;
  color: #bbb;
  margin-top: 6rpx;
}

.mn-img-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.mn-img-preview {
  position: relative;
  width: 160rpx;
  height: 160rpx;
  border-radius: 12rpx;
  overflow: hidden;
}

.mn-img-preview image {
  width: 100%;
  height: 100%;
}

.mn-img-remove {
  position: absolute;
  top: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 24rpx;
  padding: 4rpx 12rpx;
  border-radius: 0 0 0 12rpx;
}

.mn-img-pick {
  width: 160rpx;
  height: 160rpx;
  border: 2rpx dashed #ccc;
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.mn-img-pick-icon {
  font-size: 44rpx;
  color: #bbb;
}

.mn-img-pick-text {
  font-size: 22rpx;
  color: #bbb;
}

.mn-form-btns {
  display: flex;
  gap: 20rpx;
  margin-top: 8rpx;
}

.mn-btn {
  flex: 1;
  border-radius: 44rpx;
  font-size: 28rpx;
}

.mn-btn.ghost {
  background: #f5f5f5;
  color: #666;
}

.mn-btn.primary {
  background: #4a90e2;
  color: #fff;
}
</style>
