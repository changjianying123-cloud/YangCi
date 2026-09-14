import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage, Server } from 'http';
import { verifyToken } from '../utils/jwt';

/**
 * WebSocket 中心：
 * - 客户端连上后先发 { type:'auth', token }，或直接 ?token=xxx
 * - 认证成功后加入个人频道 user:<id>，并可 join 房间频道 room:<roomId>
 * - 服务端任何状态变化 → broadcast 给房间内所有人，或 push 给某个用户
 *
 * 消息格式统一：
 *   客户端→服务端：{ type, ...payload }
 *   服务端→客户端：{ type, data }
 */

interface Client {
  ws: WebSocket;
  userId: number;
  rooms: Set<number>;
  alive: boolean;
}

const clients = new Set<Client>();
const byUser = new Map<number, Set<Client>>();

let wss: WebSocketServer | null = null;

export function initWs(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // 支持 ?token=xxx 直接认证（小程序 uni.connectSocket 方便）
    const url = new URL(req.url || '/ws', 'http://localhost');
    const qToken = url.searchParams.get('token');
    let client: Client | null = null;

    const doAuth = (userId: number) => {
      if (client) return;
      client = { ws, userId, rooms: new Set(), alive: true };
      clients.add(client);
      if (!byUser.has(userId)) byUser.set(userId, new Set());
      byUser.get(userId)!.add(client);
      sendTo(ws, { type: 'auth_ok', data: { userId } });
      onConnect?.(userId);
    };

    if (qToken) {
      const payload = verifyToken(qToken);
      if (payload) doAuth(payload.userId);
    }

    ws.on('message', (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'ping') { sendTo(ws, { type: 'pong', data: {} }); return; }
      if (msg.type === 'auth') {
        const payload = verifyToken(String(msg.token || ''));
        if (payload) doAuth(payload.userId);
        else sendTo(ws, { type: 'auth_fail', data: {} });
        return;
      }
      if (!client) { sendTo(ws, { type: 'error', data: { msg: '未认证' } }); return; }
      if (msg.type === 'join_room') {
        const rid = Number(msg.roomId);
        if (Number.isFinite(rid)) client.rooms.add(rid);
        return;
      }
      if (msg.type === 'leave_room') {
        const rid = Number(msg.roomId);
        client.rooms.delete(rid);
        return;
      }
    });

    ws.on('close', () => {
      if (!client) return;
      clients.delete(client);
      const set = byUser.get(client.userId);
      if (set) { set.delete(client); if (!set.size) byUser.delete(client.userId); }
      onDisconnect?.(client.userId);
    });

    ws.on('error', () => { /* 忽略单连接错误 */ });
  });

  // 心跳：30s 一次，清掉死连接
  const hb = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { try { c.ws.terminate(); } catch { /* ignore */ } continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* ignore */ }
    }
  }, 30000);
  wss.on('connection', (ws) => { ws.on('pong', () => { for (const c of clients) if (c.ws === ws) c.alive = true; }); });
  wss.on('close', () => clearInterval(hb));

  return wss;
}

/** 断线回调（由房间服务注入，用于判负） */
let onDisconnect: ((userId: number) => void) | null = null;
export function setDisconnectHandler(fn: (userId: number) => void) {
  onDisconnect = fn;
}

/** 上线回调（由房间服务注入，用于清除断线计时，防止重连后被误判负） */
let onConnect: ((userId: number) => void) | null = null;
export function setConnectHandler(fn: (userId: number) => void) {
  onConnect = fn;
}

function sendTo(ws: WebSocket, obj: unknown) {
  try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
}

/** 推给某个用户的所有连接 */
export function pushToUser(userId: number, obj: unknown) {
  const set = byUser.get(userId);
  if (!set) return;
  for (const c of set) sendTo(c.ws, obj);
}

/** 广播给某房间内所有已加入该房间频道的人 */
export function broadcastRoom(roomId: number, obj: unknown) {
  for (const c of clients) {
    if (c.rooms.has(roomId)) sendTo(c.ws, obj);
  }
}

/** 广播给所有人（如房间列表更新） */
export function broadcastAll(obj: unknown) {
  for (const c of clients) sendTo(c.ws, obj);
}

/** 某用户是否在线（有活跃 WS 连接） */
export function isUserOnline(userId: number): boolean {
  const set = byUser.get(userId);
  return !!set && set.size > 0;
}

export function onlineCount(): number {
  return clients.size;
}
