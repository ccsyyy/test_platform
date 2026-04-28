import "dotenv/config";
import { mysqlPool } from "../db/mysql.js";
import { config } from "../config.js";

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await mysqlPool.query(
    `
    SELECT COUNT(*) AS total
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `,
    [config.MYSQL_DATABASE, tableName, columnName]
  );
  return Number((rows as Array<{ total: number }>)[0]?.total || 0) > 0;
}

async function indexExists(tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await mysqlPool.query(
    `
    SELECT COUNT(*) AS total
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
    `,
    [config.MYSQL_DATABASE, tableName, indexName]
  );
  return Number((rows as Array<{ total: number }>)[0]?.total || 0) > 0;
}

async function addColumnIfMissing(tableName: string, columnName: string, definition: string): Promise<void> {
  if (await columnExists(tableName, columnName)) {
    return;
  }
  await mysqlPool.query(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

async function addIndexIfMissing(tableName: string, indexName: string, definition: string): Promise<void> {
  if (await indexExists(tableName, indexName)) {
    return;
  }
  await mysqlPool.query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} ${definition}`);
}

async function main() {
  await addColumnIfMissing("tp_element_locator", "source", "source VARCHAR(32) NOT NULL DEFAULT 'recording'");
  await addColumnIfMissing("tp_element_locator", "status", "status VARCHAR(32) NOT NULL DEFAULT 'active'");
  await addColumnIfMissing("tp_element_locator", "priority", "priority INT NOT NULL DEFAULT 100");
  await addColumnIfMissing("tp_element_locator", "confidence", "confidence DECIMAL(5,2) NULL");
  await addColumnIfMissing("tp_element_locator", "last_success_at", "last_success_at DATETIME(3) NULL");
  await addColumnIfMissing("tp_element_locator", "last_failed_at", "last_failed_at DATETIME(3) NULL");
  await addColumnIfMissing("tp_element_locator", "success_count", "success_count INT NOT NULL DEFAULT 0");
  await addColumnIfMissing("tp_element_locator", "failed_count", "failed_count INT NOT NULL DEFAULT 0");

  await addIndexIfMissing("tp_element_locator", "idx_tp_element_locator_element_status", "(element_id, status)");
  await addIndexIfMissing("tp_element_locator", "idx_tp_element_locator_element_priority", "(element_id, priority)");
  await addIndexIfMissing("tp_element_locator", "idx_tp_element_locator_source", "(source)");

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tp_project_ai_config (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      project_id BIGINT UNSIGNED NOT NULL,
      enable_locator_fallback TINYINT NOT NULL DEFAULT 1,
      enable_ai_healing TINYINT NOT NULL DEFAULT 0,
      enable_ai_captcha TINYINT NOT NULL DEFAULT 0,
      ai_provider VARCHAR(64) NULL,
      ai_model VARCHAR(128) NULL,
      ai_base_url VARCHAR(500) NULL,
      ai_api_key_encrypted TEXT NULL,
      ai_timeout_ms INT NOT NULL DEFAULT 20000,
      max_ai_attempts INT NOT NULL DEFAULT 1,
      enable_ai_visual_locator TINYINT NOT NULL DEFAULT 0,
      ai_visual_provider VARCHAR(64) NOT NULL DEFAULT 'midscene',
      ai_visual_timeout_ms INT NOT NULL DEFAULT 15000,
      ai_visual_max_attempts INT NOT NULL DEFAULT 1,
      ai_locator_confidence_threshold DECIMAL(5,2) NOT NULL DEFAULT 70.00,
      captcha_confidence_threshold DECIMAL(5,2) NOT NULL DEFAULT 80.00,
      captcha_max_attempts INT NOT NULL DEFAULT 3,
      auto_promote_healed_locator TINYINT NOT NULL DEFAULT 0,
      require_manual_review TINYINT NOT NULL DEFAULT 1,
      allow_ai_on_prod TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uk_tp_project_ai_config_project (project_id),
      CONSTRAINT fk_tp_project_ai_config_project FOREIGN KEY (project_id) REFERENCES tp_project (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await addColumnIfMissing(
    "tp_project_ai_config",
    "enable_ai_visual_locator",
    "enable_ai_visual_locator TINYINT NOT NULL DEFAULT 0"
  );
  await addColumnIfMissing(
    "tp_project_ai_config",
    "ai_visual_provider",
    "ai_visual_provider VARCHAR(64) NOT NULL DEFAULT 'midscene'"
  );
  await addColumnIfMissing(
    "tp_project_ai_config",
    "ai_visual_timeout_ms",
    "ai_visual_timeout_ms INT NOT NULL DEFAULT 15000"
  );
  await addColumnIfMissing(
    "tp_project_ai_config",
    "ai_visual_max_attempts",
    "ai_visual_max_attempts INT NOT NULL DEFAULT 1"
  );
  await addColumnIfMissing(
    "tp_project_ai_config",
    "ai_locator_confidence_threshold",
    "ai_locator_confidence_threshold DECIMAL(5,2) NOT NULL DEFAULT 70.00"
  );
  await addColumnIfMissing(
    "tp_project_ai_config",
    "captcha_confidence_threshold",
    "captcha_confidence_threshold DECIMAL(5,2) NOT NULL DEFAULT 80.00"
  );
  await addColumnIfMissing(
    "tp_project_ai_config",
    "captcha_max_attempts",
    "captcha_max_attempts INT NOT NULL DEFAULT 3"
  );

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tp_locator_heal_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      project_id BIGINT UNSIGNED NOT NULL,
      element_id BIGINT UNSIGNED NULL,
      case_id BIGINT UNSIGNED NULL,
      step_id BIGINT UNSIGNED NULL,
      job_id BIGINT UNSIGNED NULL,
      step_result_id BIGINT UNSIGNED NULL,
      page_url VARCHAR(1000) NULL,
      page_title VARCHAR(500) NULL,
      action VARCHAR(64) NOT NULL,
      old_locator_json JSON NULL,
      attempted_locators_json JSON NULL,
      ai_input_json JSON NULL,
      ai_candidates_json JSON NULL,
      selected_locator_json JSON NULL,
      confidence DECIMAL(5,2) NULL,
      reason VARCHAR(1000) NULL,
      status VARCHAR(64) NOT NULL DEFAULT 'generated',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_tp_locator_heal_log_project_status (project_id, status),
      KEY idx_tp_locator_heal_log_job (job_id),
      CONSTRAINT fk_tp_locator_heal_log_project FOREIGN KEY (project_id) REFERENCES tp_project (id),
      CONSTRAINT fk_tp_locator_heal_log_element FOREIGN KEY (element_id) REFERENCES tp_element (id),
      CONSTRAINT fk_tp_locator_heal_log_case FOREIGN KEY (case_id) REFERENCES tp_test_case (id),
      CONSTRAINT fk_tp_locator_heal_log_step FOREIGN KEY (step_id) REFERENCES tp_case_step (id),
      CONSTRAINT fk_tp_locator_heal_log_job FOREIGN KEY (job_id) REFERENCES tp_execution_job (id),
      CONSTRAINT fk_tp_locator_heal_log_step_result FOREIGN KEY (step_result_id) REFERENCES tp_execution_step_result (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await mysqlPool.query("ALTER TABLE tp_locator_heal_log MODIFY status VARCHAR(64) NOT NULL DEFAULT 'generated'");

  await mysqlPool.query(`
    UPDATE tp_element_locator
    SET source = COALESCE(NULLIF(source, ''), 'recording'),
      status = COALESCE(NULLIF(status, ''), 'active'),
      priority = COALESCE(priority, 100),
      confidence = COALESCE(confidence, score)
  `);

  console.log("AI feature migration completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mysqlPool.end().catch(() => undefined);
  });
