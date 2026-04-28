import { mysqlPool } from "../db/mysql.js";
import { config } from "../config.js";
import { parseJson } from "../utils/json.js";

export interface ProjectExecutionSettings {
  defaultBrowser: "chromium" | "chrome" | "edge";
  defaultHeadless: boolean;
  defaultRetries: number;
  defaultTimeoutMs: number;
  defaultScreenshot: boolean;
  defaultVideo: boolean;
  defaultTrace: boolean;
  reportRetentionDays: number;
  logRetentionDays: number;
}

export interface ProjectAgentSettings {
  baseUrl: string;
  healthPath: string;
  checkBeforeRecording: boolean;
  autoCheckOnLoad: boolean;
}

export interface ProjectSettings {
  projectId: number;
  execution: ProjectExecutionSettings;
  agent: ProjectAgentSettings;
}

const DEFAULT_AGENT_BASE_URL = "http://127.0.0.1:37665";
let ensureProjectSettingsSchemaPromise: Promise<void> | null = null;

function defaultProjectSettings(projectId: number): ProjectSettings {
  return {
    projectId,
    execution: {
      defaultBrowser: "chrome",
      defaultHeadless: true,
      defaultRetries: 0,
      defaultTimeoutMs: 30000,
      defaultScreenshot: true,
      defaultVideo: true,
      defaultTrace: false,
      reportRetentionDays: 30,
      logRetentionDays: 7
    },
    agent: {
      baseUrl: DEFAULT_AGENT_BASE_URL,
      healthPath: "/health",
      checkBeforeRecording: true,
      autoCheckOnLoad: true
    }
  };
}

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

async function addColumnIfMissing(tableName: string, columnName: string, definition: string): Promise<void> {
  if (await columnExists(tableName, columnName)) {
    return;
  }
  await mysqlPool.query(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

export async function ensureProjectSettingsSchema(): Promise<void> {
  if (ensureProjectSettingsSchemaPromise) {
    return ensureProjectSettingsSchemaPromise;
  }
  ensureProjectSettingsSchemaPromise = (async () => {
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS tp_project_setting (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        project_id BIGINT UNSIGNED NOT NULL,
        execution_config_json JSON NULL,
        agent_config_json JSON NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uk_tp_project_setting_project (project_id),
        CONSTRAINT fk_tp_project_setting_project FOREIGN KEY (project_id) REFERENCES tp_project (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await addColumnIfMissing(
      "tp_project_setting",
      "execution_config_json",
      "execution_config_json JSON NULL"
    );
    await addColumnIfMissing("tp_project_setting", "agent_config_json", "agent_config_json JSON NULL");
  })().catch((error) => {
    ensureProjectSettingsSchemaPromise = null;
    throw error;
  });
  return ensureProjectSettingsSchemaPromise;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.round(numeric), max));
}

function normalizeBrowser(
  value: unknown,
  fallback: ProjectExecutionSettings["defaultBrowser"]
): ProjectExecutionSettings["defaultBrowser"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "chrome" || normalized === "edge" || normalized === "chromium") {
    return normalized;
  }
  return fallback;
}

function normalizeHealthPath(value: unknown, fallback: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeExecutionSettings(
  value: unknown,
  fallback: ProjectExecutionSettings
): ProjectExecutionSettings {
  const record = parseJson<Record<string, unknown>>(value, {});
  return {
    defaultBrowser: normalizeBrowser(record.defaultBrowser, fallback.defaultBrowser),
    defaultHeadless: toBoolean(record.defaultHeadless, fallback.defaultHeadless),
    defaultRetries: toBoundedInteger(record.defaultRetries, fallback.defaultRetries, 0, 5),
    defaultTimeoutMs: toBoundedInteger(record.defaultTimeoutMs, fallback.defaultTimeoutMs, 1000, 300000),
    defaultScreenshot: toBoolean(record.defaultScreenshot, fallback.defaultScreenshot),
    defaultVideo: toBoolean(record.defaultVideo, fallback.defaultVideo),
    defaultTrace: toBoolean(record.defaultTrace, fallback.defaultTrace),
    reportRetentionDays: toBoundedInteger(record.reportRetentionDays, fallback.reportRetentionDays, 1, 3650),
    logRetentionDays: toBoundedInteger(record.logRetentionDays, fallback.logRetentionDays, 1, 3650)
  };
}

function normalizeAgentSettings(value: unknown, fallback: ProjectAgentSettings): ProjectAgentSettings {
  const record = parseJson<Record<string, unknown>>(value, {});
  const baseUrl = String(record.baseUrl || "").trim().replace(/\/+$/, "");
  return {
    baseUrl: baseUrl || fallback.baseUrl,
    healthPath: normalizeHealthPath(record.healthPath, fallback.healthPath),
    checkBeforeRecording: toBoolean(record.checkBeforeRecording, fallback.checkBeforeRecording),
    autoCheckOnLoad: toBoolean(record.autoCheckOnLoad, fallback.autoCheckOnLoad)
  };
}

function normalizeProjectSettingsRow(row: Record<string, unknown> | undefined, projectId: number): ProjectSettings {
  const defaults = defaultProjectSettings(projectId);
  return {
    projectId,
    execution: normalizeExecutionSettings(row?.executionConfigJson, defaults.execution),
    agent: normalizeAgentSettings(row?.agentConfigJson, defaults.agent)
  };
}

export async function getProjectSettings(projectId: number): Promise<ProjectSettings> {
  await ensureProjectSettingsSchema();
  const [rows] = await mysqlPool.query(
    `
    SELECT project_id AS projectId,
      execution_config_json AS executionConfigJson,
      agent_config_json AS agentConfigJson
    FROM tp_project_setting
    WHERE project_id = ?
    LIMIT 1
    `,
    [projectId]
  );
  return normalizeProjectSettingsRow((rows as Array<Record<string, unknown>>)[0], projectId);
}

export async function saveProjectSettings(
  projectId: number,
  input: {
    execution?: Partial<ProjectExecutionSettings>;
    agent?: Partial<ProjectAgentSettings>;
  }
): Promise<ProjectSettings> {
  await ensureProjectSettingsSchema();
  const current = await getProjectSettings(projectId);
  const next: ProjectSettings = {
    projectId,
    execution: normalizeExecutionSettings(
      {
        ...current.execution,
        ...(input.execution || {})
      },
      current.execution
    ),
    agent: normalizeAgentSettings(
      {
        ...current.agent,
        ...(input.agent || {})
      },
      current.agent
    )
  };
  await mysqlPool.query(
    `
    INSERT INTO tp_project_setting (
      project_id, execution_config_json, agent_config_json
    )
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      execution_config_json = VALUES(execution_config_json),
      agent_config_json = VALUES(agent_config_json),
      updated_at = NOW(3)
    `,
    [projectId, JSON.stringify(next.execution), JSON.stringify(next.agent)]
  );
  return getProjectSettings(projectId);
}
