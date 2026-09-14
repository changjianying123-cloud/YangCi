let innerAudio = null;

function getAudioContext() {
  if (!innerAudio) {
    innerAudio = uni.createInnerAudioContext();
  }
  return innerAudio;
}

export function playWordAudio(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('无音频地址'));
      return;
    }
    const ctx = getAudioContext();
    ctx.stop();
    
    // 重置并确保不跟随静音键
    ctx.obeyMuteSwitch = false;
    ctx.src = url;

    // 等音频加载完成后再播放
    const onCanplay = () => {
      ctx.offCanplay(onCanplay);
      ctx.play();
    };

    ctx.onCanplay(onCanplay);
    ctx.onEnded(() => resolve());
    ctx.onError((err) => reject(err));

    // 兜底：某些情况下 onCanplay 可能不触发，用 timeupdate 超时
    const fallback = setTimeout(() => {
      ctx.offCanplay(onCanplay);
      ctx.play();
    }, 2000);

    ctx.onPlay(() => clearTimeout(fallback));
  });
}

export function stopAudio() {
  if (innerAudio) {
    innerAudio.stop();
  }
}

export function destroyAudio() {
  if (innerAudio) {
    innerAudio.destroy();
    innerAudio = null;
  }
}
