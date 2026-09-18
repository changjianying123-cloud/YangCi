import { pool } from '../db/pool';

/**
 * 写入用户最后活跃时间（节流：同一用户 60s 内只写一次），用于 DAU / 在线统计。
 * 普通接口走 authMiddleware、后台接口走 adminMiddleware，两处都调用它。
 */
const lastActiveWrite = new Map<number, number>();
export function touchLastActive(userId: number) {
  const now = Date.now();
  const prev = lastActiveWrite.get(userId) || 0;
  if (now - prev < 60 * 1000) return;
  lastActiveWrite.set(userId, now);
  pool.execute('UPDATE users SET last_active_at = ? WHERE id = ?', [now, userId]).catch(() => {
    /* 统计失败不影响业务 */
  });
}
