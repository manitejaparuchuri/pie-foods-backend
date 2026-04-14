import dotenv from "dotenv";
import mysql from 'mysql2/promise';

dotenv.config({ override: true });

export const adminEnv = {
  adminId: String(process.env.ADMIN_ID || "").trim(),
  adminPassword: String(process.env.ADMIN_PASSWORD || "").trim(),
};

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME, 
  port: Number(process.env.DB_PORT || 3306),
  connectionLimit: 10
});
export default pool;

