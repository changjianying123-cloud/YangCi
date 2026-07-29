let innerAudio = null;

function getAudioContext() {
  if (!innerAudio) {
    innerAudio = uni.createInnerAudioContext();
    innerAudio.obeyMuteSwitch = false;
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
    ctx.src = url;
    ctx.onEnded(() => resolve());
    ctx.onError((err) => reject(err));
    ctx.play();
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
