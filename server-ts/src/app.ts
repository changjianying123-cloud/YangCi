import express from 'express';
import cors from 'cors';
import http from 'http';
import { config } from './config';
import { initDatabase } from './db/init';
import authRoutes from './routes/auth';
import bookRoutes from './routes/book';
import wordRoutes from './routes/word';
import cardRoutes from './routes/card';
import statRoutes from './routes/stat';
import battleRoutes from './routes/battle';
import adminRoutes from './routes/admin';
import { initWs, setDisconnectHandler, setConnectHandler } from './ws/hub';
import { handleDisconnect, handleReconnect, startRoomScanner } from './services/battleRoomService';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ code: 200, msg: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/book', bookRoutes);
app.use('/api/word', wordRoutes);
app.use('/api/card', cardRoutes);
app.use('/api/stat', statRoutes);
app.use('/api/battle', battleRoutes);
app.use('/api/admin', adminRoutes);

const server = http.createServer(app);
initWs(server);
// WS 断线/重连 → 房间断线判负计时
setDisconnectHandler((userId) => {
  handleDisconnect(userId);
});
// WS 上线（含重连）→ 清除断线计时，避免重连后被误判「断线超时」
setConnectHandler((userId) => {
  handleReconnect(userId);
});

initDatabase()
  .then(() => {
    startRoomScanner();
    server.listen(config.port, () => {
      console.log(`养词小程序后端已启动: http://localhost:${config.port}`);
      console.log(`WebSocket 已监听: ws://localhost:${config.port}/ws`);
    });
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  });

export default app;
