import { request } from '@/utils/request.js';

/**
 * 上传图片
 * base64 方案：小程序端先把图片读成 base64 再 POST（项目没引 multer，避免加依赖）
 * @param {string} filePath 本地临时文件路径（uni.chooseImage 拿到的）
 * @returns {Promise<{data:{url:string,size:number}}>}
 */
export function uploadImage(filePath) {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    const fs = uni.getFileSystemManager();
    fs.readFile({
      filePath,
      encoding: 'base64',
      success(res) {
        const base64 = res.data;
        const ext = (filePath.split('.').pop() || 'png').toLowerCase();
        request('/upload/image', {
          method: 'POST',
          data: { data: base64, ext, mime: extToMime(ext) },
        })
          .then(resolve)
          .catch(reject);
      },
      fail(err) {
        reject(err);
      },
    });
    // #endif

    // #ifndef MP-WEIXIN
    // H5 等平台用 FileReader
    try {
      fetch(filePath)
        .then((r) => r.blob())
        .then(
          (blob) =>
            new Promise((res2) => {
              const reader = new FileReader();
              reader.onload = () => res2(String(reader.result || ''));
              reader.readAsDataURL(blob);
            })
        )
        .then((dataUrl) =>
          request('/upload/image', { method: 'POST', data: { data: dataUrl } })
        )
        .then(resolve)
        .catch(reject);
    } catch (e) {
      reject(e);
    }
    // #endif
  });
}

function extToMime(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };
  return map[ext] || 'image/png';
}
