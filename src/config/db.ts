import mysql from 'mysql2/promise';
import { getEnvValue } from "./env";

export const adminEnv = {
  adminId: getEnvValue("ADMIN_ID"),
  adminPassword: getEnvValue("ADMIN_PASSWORD"),
};

const pool = mysql.createPool({
  host: getEnvValue("DB_HOST"),
  user: getEnvValue("DB_USER"),
  password: getEnvValue("DB_PASS"),
  database: getEnvValue("DB_NAME"),
  port: Number(getEnvValue("DB_PORT") || 3306),
  connectionLimit: 10
});
export default pool;

