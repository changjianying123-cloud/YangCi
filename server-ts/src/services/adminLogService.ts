import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool';

/**
 * 管理员操作日志：任何高危写操作（改金�?封禁/改词/删词等）都记一条�? * 便于事后追溯「谁在什么时候改了什么」�? */
export async function logAdminAction(
  adminId: number,
  action: string,
  targetType: string,
  targetId: number | null,
  detail?: unknown,
  ip?: string | null
) {
  try {
    await pool.execute(
      `INSERT INTO admin_logs (admin_id, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        adminId,
        action,
        targetType,
        targetId ?? null,
        detail === undefined ? null : JSON.stringify(detail),
        ip || null,
      ]
    );
  } catch (_) {
    /* 日志失败不影响主流程 */
  }
}

export async function listAdminLogs(opts: {
  page?: number;
  pageSize?: number;
  action?: string;
  adminId?: number;
}) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: any[] = [];
  if (opts.action) {
    where.push('l.action = ?');
    params.push(opts.action);
  }
  if (opts.adminId) {
    where.push('l.admin_id = ?');
    params.push(opts.adminId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM admin_logs l ${whereSql}`,
    params
  );
  const total = Number((countRows[0] as { total: number })?.total) || 0;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT l.*, u.nickname AS admin_nickname, u.username AS admin_username
     FROM admin_logs l
     LEFT JOIN users u ON u.id = l.admin_id
     ${whereSql}
     ORDER BY l.id DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      adminId: r.admin_id,
      adminName: r.admin_nickname || r.admin_username || `#${r.admin_id}`,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      detail: r.detail,
      ip: r.ip,
      createdAt: r.created_at,
    })),
    total,
    page,
    pageSize,
  };
}
