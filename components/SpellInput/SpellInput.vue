<template>
  <view class="spell-input-wrap">
    <input
      class="spell-input"
      :value="value"
      :placeholder="placeholder"
      :disabled="disabled"
      :focus="inputFocus"
      confirm-type="done"
      :adjust-position="true"
      :hold-keyboard="true"
      @input="onInput"
      @confirm="onConfirm"
      @blur="onBlur"
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
    // 是否让输入框保持聚焦（父级用 :focus 控制，回车提交后重新置 true 即可继续输入）
    focus: { type: Boolean, default: false },
  },
  data() {
    return {
      innerFocus: false,
    };
  },
  computed: {
    // 外层传入的 focus 与内部闪烁状态取或：重新聚焦必须走一次 false->true 的变化，
    // 否则小程序里 focus 一直是 true 时再设 true 是空操作，键盘不会重新弹出
    inputFocus() {
      return this.focus || this.innerFocus;
    },
  },
  watch: {
    // 从「不聚焦」变为「聚焦」时主动置焦
    focus(val) {
      if (val) this.refocus();
    },
  },
  methods: {
    onInput(e) {
      this.$emit('input', e.detail.value);
    },
    onConfirm() {
      this.$emit('submit', this.value);
    },
    onBlur() {
      this.$emit('blur');
    },
    /**
     * 强制重新聚焦（供父级在回车提交后调用）
     * 小程序中 focus 属性需要在同一帧内先置 false 再置 true 才会重新弹起键盘
     */
    refocus() {
      this.innerFocus = false;
      this.$nextTick(() => {
        this.innerFocus = true;
        this.$nextTick(() => {
          // 把控制权还给 focus 属性，避免内部状态一直占用
          this.innerFocus = false;
        });
      });
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
