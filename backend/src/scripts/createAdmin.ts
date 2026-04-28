import { config } from "../config.js";
import { mysqlPool } from "../db/mysql.js";
import { hashPassword } from "../utils/password.js";

async function main() {
  if (!config.ADMIN_USERNAME || !config.ADMIN_PASSWORD) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required");
  }
  if (config.ADMIN_PASSWORD.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  }

  const [roleRows] = await mysqlPool.query("SELECT id FROM sys_role WHERE role_code = 'admin'");
  const role = (roleRows as Array<{ id: number }>)[0];
  if (!role) {
    throw new Error("admin role does not exist. Run database/init_mysql.sql first.");
  }

  const passwordHash = await hashPassword(config.ADMIN_PASSWORD);
  await mysqlPool.query(
    `
    INSERT INTO sys_user (username, password_hash, display_name, role_id, status)
    VALUES (?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      password_hash = VALUES(password_hash),
      display_name = VALUES(display_name),
      role_id = VALUES(role_id),
      status = 1,
      updated_at = NOW(3)
    `,
    [config.ADMIN_USERNAME, passwordHash, config.ADMIN_DISPLAY_NAME ?? "系统管理员", role.id]
  );

  console.log(`Admin user is ready: ${config.ADMIN_USERNAME}`);
  await mysqlPool.end();
}

main().catch(async (error) => {
  console.error(error);
  await mysqlPool.end();
  process.exit(1);
});
