import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';

const router = Router();

/** 图片上传目录：server-ts/uploads/<yyyymm>/ */
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const MAX_BYTES = 5 * 1024 * 1024; // 单图 5MB

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

/**
 * 上传图片（base64）
 * POST /api/upload/image
 * body: { data: "data:image/png;base64,...." 或纯 base64, ext?: "png" }
 *
 * 为什么用 base64 而不是 multipart：
 *   项目没引 multer，也不想为一个上传点加依赖 + 多部分解析。
 *   小程序端 uni.getFileSystemManager().readFile({encoding:'base64'}) 即可，
 *   体积可控（已限 5MB），配合 express.json limit 20mb 足够。
 */
router.post('/image', authMiddleware, async (req: Request, res: Response) => {
  try {
    let data = String(req.body?.data || '');
    if (!data) return fail(res, 400, '缺少图片数据');

    // 支持 dataURL 前缀
    let mime = String(req.body?.mime || '');
    const m = data.match(/^data:([^;]+);base64,(.*)$/);
    if (m) {
      mime = m[1];
      data = m[2];
    }

    // base64 长度换算成字节数
    // 先严格校验字符集：Buffer.from(x,'base64') 对非法字符不报错，会静默解出垃圾
    const clean = data.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) {
      return fail(res, 400, '图片数据不是合法的 base64');
    }
    const padding = (clean.match(/=+$/) || [''])[0].length;
    const bytes = Math.floor((clean.length * 3) / 4) - padding;
    if (bytes <= 0) return fail(res, 400, '图片数据无效');
    if (bytes > MAX_BYTES) return fail(res, 400, '图片过大（最大 5MB）');

    let ext = MIME_EXT[mime] || '';
    if (!ext) {
      // 没给 mime 就按魔数嗅探
      const head = Buffer.from(clean.slice(0, 24), 'base64');
      if (head[0] === 0xff && head[1] === 0xd8) ext = 'jpg';
      else if (head[0] === 0x89 && head[1] === 0x50) ext = 'png';
      else if (head[0] === 0x47 && head[1] === 0x49) ext = 'gif';
      else if (head.slice(8, 12).toString('ascii') === 'WEBP') ext = 'webp';
      else ext = String(req.body?.ext || '').replace(/[^a-z0-9]/gi, '') || 'png';
    }

    const buf = Buffer.from(clean, 'base64');
    const ym = new Date();
    const dir = path.join(UPLOAD_ROOT, `${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}`);
    fs.mkdirSync(dir, { recursive: true });

    const name = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, buf);

    const rel = `/uploads/${path.basename(dir)}/${name}`;
    ok(res, { url: rel, size: bytes }, '上传成功');
  } catch (err: unknown) {
    fail(res, 500, err instanceof Error ? err.message : '上传失败');
  }
});

export default router;
