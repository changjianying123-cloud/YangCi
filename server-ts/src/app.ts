import express from 'express';
import cors from 'cors';
import { config } from './config';
import { initDatabase } from './db/init';
import authRoutes from './routes/auth';
import bookRoutes from './routes/book';
import wordRoutes from './routes/word';
import cardRoutes from './routes/card';
import statRoutes from './routes/stat';

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

initDatabase()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`养词小程序后端已启动: http://localhost:${config.port}`);
    });
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  });

export default app;
