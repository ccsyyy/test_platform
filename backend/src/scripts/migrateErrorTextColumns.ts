import "dotenv/config";
import { mysqlPool } from "../db/mysql.js";

async function main() {
  const statements = [
    "ALTER TABLE tp_execution_job MODIFY COLUMN error_message TEXT NULL",
    "ALTER TABLE tp_execution_case_result MODIFY COLUMN error_message TEXT NULL",
    "ALTER TABLE tp_execution_step_result MODIFY COLUMN error_message TEXT NULL",
    "ALTER TABLE tp_element MODIFY COLUMN last_error TEXT NULL",
    "ALTER TABLE tp_element_locator MODIFY COLUMN last_error TEXT NULL",
    "ALTER TABLE tp_locator_heal_log MODIFY COLUMN reason TEXT NULL"
  ];

  for (const statement of statements) {
    await mysqlPool.query(statement);
  }

  console.log("Error text column migration completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mysqlPool.end().catch(() => undefined);
  });
