import mysql from "mysql2/promise";
import { config } from "../config.js";

export const mysqlPool = mysql.createPool({
  host: config.MYSQL_HOST,
  port: config.MYSQL_PORT,
  user: config.MYSQL_USER,
  password: config.MYSQL_PASSWORD,
  database: config.MYSQL_DATABASE,
  connectionLimit: config.MYSQL_CONNECTION_LIMIT,
  charset: "utf8mb4",
  timezone: "+00:00"
});

export async function pingMysql(): Promise<void> {
  const connection = await mysqlPool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}
