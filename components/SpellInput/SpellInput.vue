<template>
  <view class="spell-input-wrap">
    <input
      class="spell-input"
      :value="value"
      :placeholder="placeholder"
      :disabled="disabled"
      confirm-type="done"
      @input="onInput"
      @confirm="onConfirm"
    />
    <button class="submit-btn" :disabled="disabled" @click="onConfirm">{{ buttonText }}</button>
  </view>
</template>

<script>
export default {
  name: 'SpellInput',
  props: {
    value: { type: String, default: '' },
    placeholder: { type: String, default: '请输入单词拼写...' },
    disabled: { type: Boolean, default: false },
    buttonText: { type: String, default: '确认' },
  },
  methods: {
    onInput(e) {
      this.$emit('input', e.detail.value);
    },
    onConfirm() {
      this.$emit('submit', this.value);
    },
  },
};
</script>

<style scoped>
.spell-input-wrap {
  display: flex;
  gap: 20rpx;
  align-items: center;
}

.spell-input {
  flex: 1;
  background: #fff;
  padding: 24rpx;
  border-radius: 16rpx;
  font-size: 30rpx;
  border: 2rpx solid #eee;
}

.submit-btn {
  background: #4a90e2;
  color: #fff;
  font-size: 28rpx;
  padding: 0 32rpx;
  border-radius: 16rpx;
  height: 80rpx;
  line-height: 80rpx;
}
</style>
