import mysql, { Pool } from 'mysql2/promise';
import { config } from '../config';

export const pool: Pool = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: 'utf8mb4',
  connectionLimit: 10,
});
