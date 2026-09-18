/**
 * 时间工具
 *
 * ⚠️ mysql2 对 TIMESTAMP/DATETIME 列默认返回 JS Date 对象，
 *    而 `Number(new Date())` 是 NaN（不是时间戳）——直接 JSON 返回给前端
 *    会变成 null 或 NaN，前端格式化就成了 NaN-NaN-NaN。
 *    所以统一走 toMillis() 转成毫秒数再出接口。
 */
export function toMillis(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
