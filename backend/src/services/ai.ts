import { mysqlPool } from "../db/mysql.js";
import { config } from "../config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { parseJson } from "../utils/json.js";
import { spawn } from "node:child_process";

let ensureProjectAiConfigSchemaPromise: Promise<void> | null = null;

export interface ProjectAiConfig {
  id?: number;
  projectId: number;
  enableLocatorFallback: boolean;
  enableAiHealing: boolean;
  enableAiCaptcha: boolean;
  aiProvider: string;
  aiModel: string;
  aiBaseUrl: string;
  aiTimeoutMs: number;
  maxAiAttempts: number;
  enableAiVisualLocator: boolean;
  aiVisualProvider: string;
  aiVisualModel: string;
  aiVisualBaseUrl: string;
  aiVisualModelFamily: string;
  aiVisualTimeoutMs: number;
  aiVisualMaxAttempts: number;
  aiVisualHasApiKey: boolean;
  aiVisualApiKey?: string;
  aiLocatorConfidenceThreshold: number;
  captchaConfidenceThreshold: number;
  captchaMaxAttempts: number;
  aiCaptchaProvider: string;
  aiCaptchaModel: string;
  aiCaptchaBaseUrl: string;
  aiCaptchaTimeoutMs: number;
  aiCaptchaHasApiKey: boolean;
  aiCaptchaApiKey?: string;
  autoPromoteHealedLocator: boolean;
  requireManualReview: boolean;
  allowAiOnProd: boolean;
  hasApiKey: boolean;
  apiKey?: string;
}

export interface AiConnectionConfig {
  provider: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  hasApiKey: boolean;
  apiKey?: string;
}

export interface AiLocatorSuggestion {
  locatorType: string;
  locatorValue: string;
  locatorExpression?: string | null;
  confidence?: number;
  reason?: string;
}

export interface AiCaptchaRecognition {
  text: string;
  confidence?: number;
  reason?: string;
  raw?: Record<string, unknown>;
}

export interface AiModelTestResult {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  message: string;
  raw?: Record<string, unknown>;
}

function defaultAiConfig(projectId: number): ProjectAiConfig {
  return {
    projectId,
    enableLocatorFallback: true,
    enableAiHealing: false,
    enableAiCaptcha: false,
    aiProvider: config.AI_DEFAULT_PROVIDER || "openai-compatible",
    aiModel: config.AI_DEFAULT_MODEL || "",
    aiBaseUrl: config.AI_DEFAULT_BASE_URL || "",
    aiTimeoutMs: config.AI_DEFAULT_TIMEOUT_MS,
    maxAiAttempts: 1,
    enableAiVisualLocator: false,
    aiVisualProvider: "midscene",
    aiVisualModel: "",
    aiVisualBaseUrl: "",
    aiVisualModelFamily: "",
    aiVisualTimeoutMs: 15000,
    aiVisualMaxAttempts: 1,
    aiVisualHasApiKey: false,
    aiVisualApiKey: "",
    aiLocatorConfidenceThreshold: 70,
    captchaConfidenceThreshold: 80,
    captchaMaxAttempts: 3,
    aiCaptchaProvider: "",
    aiCaptchaModel: "",
    aiCaptchaBaseUrl: "",
    aiCaptchaTimeoutMs: config.AI_DEFAULT_TIMEOUT_MS,
    aiCaptchaHasApiKey: false,
    aiCaptchaApiKey: "",
    autoPromoteHealedLocator: false,
    requireManualReview: true,
    allowAiOnProd: false,
    hasApiKey: Boolean(config.AI_DEFAULT_API_KEY),
    apiKey: config.AI_DEFAULT_API_KEY || ""
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

export async function ensureProjectAiConfigSchema(): Promise<void> {
  if (ensureProjectAiConfigSchemaPromise) {
    return ensureProjectAiConfigSchemaPromise;
  }
  ensureProjectAiConfigSchemaPromise = (async () => {
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
        ai_visual_model VARCHAR(128) NULL,
        ai_visual_base_url VARCHAR(500) NULL,
        ai_visual_api_key_encrypted TEXT NULL,
        ai_visual_model_family VARCHAR(64) NULL,
        ai_visual_timeout_ms INT NOT NULL DEFAULT 15000,
        ai_visual_max_attempts INT NOT NULL DEFAULT 1,
        ai_locator_confidence_threshold DECIMAL(5,2) NOT NULL DEFAULT 70.00,
        captcha_confidence_threshold DECIMAL(5,2) NOT NULL DEFAULT 80.00,
        captcha_max_attempts INT NOT NULL DEFAULT 3,
        ai_captcha_provider VARCHAR(64) NULL,
        ai_captcha_model VARCHAR(128) NULL,
        ai_captcha_base_url VARCHAR(500) NULL,
        ai_captcha_api_key_encrypted TEXT NULL,
        ai_captcha_timeout_ms INT NOT NULL DEFAULT 20000,
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
      "ai_visual_model",
      "ai_visual_model VARCHAR(128) NULL"
    );
    await addColumnIfMissing(
      "tp_project_ai_config",
      "ai_visual_base_url",
      "ai_visual_base_url VARCHAR(500) NULL"
    );
    await addColumnIfMissing(
      "tp_project_ai_config",
      "ai_visual_api_key_encrypted",
      "ai_visual_api_key_encrypted TEXT NULL"
    );
    await addColumnIfMissing(
      "tp_project_ai_config",
      "ai_visual_model_family",
      "ai_visual_model_family VARCHAR(64) NULL"
    );
    await addColumnIfMissing(
      "tp_project_ai_config",
      "ai_captcha_provider",
      "ai_captcha_provider VARCHAR(64) NULL"
    );
    await addColumnIfMissing(
      "tp_project_ai_config",
      "ai_captcha_model",
      "ai_captcha_model VARCHAR(128) NULL"
    );
    await addColumnIfMissing(
      "tp_project_ai_config",
      "ai_captcha_base_url",
      "ai_captcha_base_url VARCHAR(500) NULL"
    );
    await addColumnIfMissing(
      "tp_project_ai_config",
      "ai_captcha_api_key_encrypted",
      "ai_captcha_api_key_encrypted TEXT NULL"
    );
    await addColumnIfMissing(
      "tp_project_ai_config",
      "ai_captcha_timeout_ms",
      "ai_captcha_timeout_ms INT NOT NULL DEFAULT 20000"
    );
  })().catch((error) => {
    ensureProjectAiConfigSchemaPromise = null;
    throw error;
  });
  return ensureProjectAiConfigSchemaPromise;
}

function normalizeAiRow(row: Record<string, unknown> | undefined, projectId: number): ProjectAiConfig {
  const defaults = defaultAiConfig(projectId);
  const decryptedKey = decryptSecret(typeof row?.aiApiKeyEncrypted === "string" ? row.aiApiKeyEncrypted : "");
  const decryptedVisualKey = decryptSecret(
    typeof row?.aiVisualApiKeyEncrypted === "string" ? row.aiVisualApiKeyEncrypted : ""
  );
  const decryptedCaptchaKey = decryptSecret(
    typeof row?.aiCaptchaApiKeyEncrypted === "string" ? row.aiCaptchaApiKeyEncrypted : ""
  );
  return {
    ...defaults,
    id: row?.id ? Number(row.id) : undefined,
    enableLocatorFallback:
      row?.enableLocatorFallback === undefined ? defaults.enableLocatorFallback : Boolean(Number(row.enableLocatorFallback)),
    enableAiHealing:
      row?.enableAiHealing === undefined ? defaults.enableAiHealing : Boolean(Number(row.enableAiHealing)),
    enableAiCaptcha:
      row?.enableAiCaptcha === undefined ? defaults.enableAiCaptcha : Boolean(Number(row.enableAiCaptcha)),
    aiProvider: typeof row?.aiProvider === "string" && row.aiProvider.trim() ? row.aiProvider : defaults.aiProvider,
    aiModel: typeof row?.aiModel === "string" ? row.aiModel : defaults.aiModel,
    aiBaseUrl: typeof row?.aiBaseUrl === "string" ? row.aiBaseUrl : defaults.aiBaseUrl,
    aiTimeoutMs: row?.aiTimeoutMs ? Number(row.aiTimeoutMs) : defaults.aiTimeoutMs,
    maxAiAttempts: row?.maxAiAttempts ? Number(row.maxAiAttempts) : defaults.maxAiAttempts,
    enableAiVisualLocator:
      row?.enableAiVisualLocator === undefined
        ? defaults.enableAiVisualLocator
        : Boolean(Number(row.enableAiVisualLocator)),
    aiVisualProvider:
      typeof row?.aiVisualProvider === "string" && row.aiVisualProvider.trim()
        ? row.aiVisualProvider
        : defaults.aiVisualProvider,
    aiVisualModel: typeof row?.aiVisualModel === "string" ? row.aiVisualModel : defaults.aiVisualModel,
    aiVisualBaseUrl: typeof row?.aiVisualBaseUrl === "string" ? row.aiVisualBaseUrl : defaults.aiVisualBaseUrl,
    aiVisualModelFamily:
      typeof row?.aiVisualModelFamily === "string" ? row.aiVisualModelFamily : defaults.aiVisualModelFamily,
    aiVisualTimeoutMs: row?.aiVisualTimeoutMs ? Number(row.aiVisualTimeoutMs) : defaults.aiVisualTimeoutMs,
    aiVisualMaxAttempts: row?.aiVisualMaxAttempts ? Number(row.aiVisualMaxAttempts) : defaults.aiVisualMaxAttempts,
    aiVisualHasApiKey: Boolean(decryptedVisualKey),
    aiVisualApiKey: decryptedVisualKey,
    aiLocatorConfidenceThreshold:
      row?.aiLocatorConfidenceThreshold === undefined || row.aiLocatorConfidenceThreshold === null
        ? defaults.aiLocatorConfidenceThreshold
        : Number(row.aiLocatorConfidenceThreshold),
    captchaConfidenceThreshold:
      row?.captchaConfidenceThreshold === undefined || row.captchaConfidenceThreshold === null
        ? defaults.captchaConfidenceThreshold
        : Number(row.captchaConfidenceThreshold),
    captchaMaxAttempts: row?.captchaMaxAttempts ? Number(row.captchaMaxAttempts) : defaults.captchaMaxAttempts,
    aiCaptchaProvider: typeof row?.aiCaptchaProvider === "string" ? row.aiCaptchaProvider : defaults.aiCaptchaProvider,
    aiCaptchaModel: typeof row?.aiCaptchaModel === "string" ? row.aiCaptchaModel : defaults.aiCaptchaModel,
    aiCaptchaBaseUrl:
      typeof row?.aiCaptchaBaseUrl === "string" ? row.aiCaptchaBaseUrl : defaults.aiCaptchaBaseUrl,
    aiCaptchaTimeoutMs: row?.aiCaptchaTimeoutMs ? Number(row.aiCaptchaTimeoutMs) : defaults.aiCaptchaTimeoutMs,
    aiCaptchaHasApiKey: Boolean(decryptedCaptchaKey),
    aiCaptchaApiKey: decryptedCaptchaKey,
    autoPromoteHealedLocator:
      row?.autoPromoteHealedLocator === undefined
        ? defaults.autoPromoteHealedLocator
        : Boolean(Number(row.autoPromoteHealedLocator)),
    requireManualReview:
      row?.requireManualReview === undefined ? defaults.requireManualReview : Boolean(Number(row.requireManualReview)),
    allowAiOnProd:
      row?.allowAiOnProd === undefined ? defaults.allowAiOnProd : Boolean(Number(row.allowAiOnProd)),
    hasApiKey: Boolean(decryptedKey || defaults.apiKey),
    apiKey: decryptedKey || defaults.apiKey
  };
}

export async function getProjectAiConfig(projectId: number): Promise<ProjectAiConfig> {
  await ensureProjectAiConfigSchema();
  const [rows] = await mysqlPool.query(
    `
    SELECT id, project_id AS projectId,
      enable_locator_fallback AS enableLocatorFallback,
      enable_ai_healing AS enableAiHealing,
      enable_ai_captcha AS enableAiCaptcha,
      ai_provider AS aiProvider,
      ai_model AS aiModel,
      ai_base_url AS aiBaseUrl,
      ai_api_key_encrypted AS aiApiKeyEncrypted,
      ai_timeout_ms AS aiTimeoutMs,
      max_ai_attempts AS maxAiAttempts,
      enable_ai_visual_locator AS enableAiVisualLocator,
      ai_visual_provider AS aiVisualProvider,
      ai_visual_model AS aiVisualModel,
      ai_visual_base_url AS aiVisualBaseUrl,
      ai_visual_api_key_encrypted AS aiVisualApiKeyEncrypted,
      ai_visual_model_family AS aiVisualModelFamily,
      ai_visual_timeout_ms AS aiVisualTimeoutMs,
      ai_visual_max_attempts AS aiVisualMaxAttempts,
      ai_locator_confidence_threshold AS aiLocatorConfidenceThreshold,
      captcha_confidence_threshold AS captchaConfidenceThreshold,
      captcha_max_attempts AS captchaMaxAttempts,
      ai_captcha_provider AS aiCaptchaProvider,
      ai_captcha_model AS aiCaptchaModel,
      ai_captcha_base_url AS aiCaptchaBaseUrl,
      ai_captcha_api_key_encrypted AS aiCaptchaApiKeyEncrypted,
      ai_captcha_timeout_ms AS aiCaptchaTimeoutMs,
      auto_promote_healed_locator AS autoPromoteHealedLocator,
      require_manual_review AS requireManualReview,
      allow_ai_on_prod AS allowAiOnProd
    FROM tp_project_ai_config
    WHERE project_id = ?
    LIMIT 1
    `,
    [projectId]
  );
  return normalizeAiRow((rows as Array<Record<string, unknown>>)[0], projectId);
}

export async function saveProjectAiConfig(
  projectId: number,
  input: Partial<ProjectAiConfig> & {
    apiKey?: string;
    clearApiKey?: boolean;
    aiVisualApiKey?: string;
    clearAiVisualApiKey?: boolean;
    aiCaptchaApiKey?: string;
    clearAiCaptchaApiKey?: boolean;
  }
): Promise<ProjectAiConfig> {
  await ensureProjectAiConfigSchema();
  const current = await getProjectAiConfig(projectId);
  const nextApiKey = input.clearApiKey ? "" : input.apiKey !== undefined ? input.apiKey.trim() : current.apiKey || "";
  const nextVisualApiKey = input.clearAiVisualApiKey
    ? ""
    : input.aiVisualApiKey !== undefined
      ? input.aiVisualApiKey.trim()
      : current.aiVisualApiKey || "";
  const nextCaptchaApiKey = input.clearAiCaptchaApiKey
    ? ""
    : input.aiCaptchaApiKey !== undefined
      ? input.aiCaptchaApiKey.trim()
      : current.aiCaptchaApiKey || "";
  const encryptedApiKey = nextApiKey ? encryptSecret(nextApiKey) : "";
  const encryptedVisualApiKey = nextVisualApiKey ? encryptSecret(nextVisualApiKey) : "";
  const encryptedCaptchaApiKey = nextCaptchaApiKey ? encryptSecret(nextCaptchaApiKey) : "";
  await mysqlPool.query(
    `
    INSERT INTO tp_project_ai_config (
      project_id, enable_locator_fallback, enable_ai_healing, enable_ai_captcha,
      ai_provider, ai_model, ai_base_url, ai_api_key_encrypted, ai_timeout_ms,
      max_ai_attempts, enable_ai_visual_locator, ai_visual_provider, ai_visual_model,
      ai_visual_base_url, ai_visual_api_key_encrypted, ai_visual_model_family, ai_visual_timeout_ms,
      ai_visual_max_attempts, ai_locator_confidence_threshold, captcha_confidence_threshold,
      captcha_max_attempts, ai_captcha_provider, ai_captcha_model, ai_captcha_base_url,
      ai_captcha_api_key_encrypted, ai_captcha_timeout_ms, auto_promote_healed_locator,
      require_manual_review, allow_ai_on_prod
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      enable_locator_fallback = VALUES(enable_locator_fallback),
      enable_ai_healing = VALUES(enable_ai_healing),
      enable_ai_captcha = VALUES(enable_ai_captcha),
      ai_provider = VALUES(ai_provider),
      ai_model = VALUES(ai_model),
      ai_base_url = VALUES(ai_base_url),
      ai_api_key_encrypted = VALUES(ai_api_key_encrypted),
      ai_timeout_ms = VALUES(ai_timeout_ms),
      max_ai_attempts = VALUES(max_ai_attempts),
      enable_ai_visual_locator = VALUES(enable_ai_visual_locator),
      ai_visual_provider = VALUES(ai_visual_provider),
      ai_visual_model = VALUES(ai_visual_model),
      ai_visual_base_url = VALUES(ai_visual_base_url),
      ai_visual_api_key_encrypted = VALUES(ai_visual_api_key_encrypted),
      ai_visual_model_family = VALUES(ai_visual_model_family),
      ai_visual_timeout_ms = VALUES(ai_visual_timeout_ms),
      ai_visual_max_attempts = VALUES(ai_visual_max_attempts),
      ai_locator_confidence_threshold = VALUES(ai_locator_confidence_threshold),
      captcha_confidence_threshold = VALUES(captcha_confidence_threshold),
      captcha_max_attempts = VALUES(captcha_max_attempts),
      ai_captcha_provider = VALUES(ai_captcha_provider),
      ai_captcha_model = VALUES(ai_captcha_model),
      ai_captcha_base_url = VALUES(ai_captcha_base_url),
      ai_captcha_api_key_encrypted = VALUES(ai_captcha_api_key_encrypted),
      ai_captcha_timeout_ms = VALUES(ai_captcha_timeout_ms),
      auto_promote_healed_locator = VALUES(auto_promote_healed_locator),
      require_manual_review = VALUES(require_manual_review),
      allow_ai_on_prod = VALUES(allow_ai_on_prod),
      updated_at = NOW(3)
    `,
    [
      projectId,
      (input.enableLocatorFallback ?? current.enableLocatorFallback) ? 1 : 0,
      (input.enableAiHealing ?? current.enableAiHealing) ? 1 : 0,
      (input.enableAiCaptcha ?? current.enableAiCaptcha) ? 1 : 0,
      input.aiProvider ?? current.aiProvider,
      input.aiModel ?? current.aiModel,
      input.aiBaseUrl ?? current.aiBaseUrl,
      encryptedApiKey,
      input.aiTimeoutMs ?? current.aiTimeoutMs,
      input.maxAiAttempts ?? current.maxAiAttempts,
      (input.enableAiVisualLocator ?? current.enableAiVisualLocator) ? 1 : 0,
      input.aiVisualProvider ?? current.aiVisualProvider,
      input.aiVisualModel ?? current.aiVisualModel,
      input.aiVisualBaseUrl ?? current.aiVisualBaseUrl,
      encryptedVisualApiKey,
      input.aiVisualModelFamily ?? current.aiVisualModelFamily,
      input.aiVisualTimeoutMs ?? current.aiVisualTimeoutMs,
      input.aiVisualMaxAttempts ?? current.aiVisualMaxAttempts,
      input.aiLocatorConfidenceThreshold ?? current.aiLocatorConfidenceThreshold,
      input.captchaConfidenceThreshold ?? current.captchaConfidenceThreshold,
      input.captchaMaxAttempts ?? current.captchaMaxAttempts,
      input.aiCaptchaProvider ?? current.aiCaptchaProvider,
      input.aiCaptchaModel ?? current.aiCaptchaModel,
      input.aiCaptchaBaseUrl ?? current.aiCaptchaBaseUrl,
      encryptedCaptchaApiKey,
      input.aiCaptchaTimeoutMs ?? current.aiCaptchaTimeoutMs,
      (input.autoPromoteHealedLocator ?? current.autoPromoteHealedLocator) ? 1 : 0,
      (input.requireManualReview ?? current.requireManualReview) ? 1 : 0,
      (input.allowAiOnProd ?? current.allowAiOnProd) ? 1 : 0
    ]
  );
  return getProjectAiConfig(projectId);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.round(numeric);
}

export function getHealingAiConnectionConfig(projectConfig: ProjectAiConfig): AiConnectionConfig {
  const apiKey = cleanText(projectConfig.apiKey);
  return {
    provider: cleanText(projectConfig.aiProvider) || "openai-compatible",
    model: cleanText(projectConfig.aiModel),
    baseUrl: cleanText(projectConfig.aiBaseUrl),
    timeoutMs: normalizeTimeoutMs(projectConfig.aiTimeoutMs, config.AI_DEFAULT_TIMEOUT_MS),
    hasApiKey: Boolean(apiKey || projectConfig.hasApiKey),
    apiKey
  };
}

export function getVisualAiConnectionConfig(projectConfig: ProjectAiConfig): AiConnectionConfig {
  const fallback = getHealingAiConnectionConfig(projectConfig);
  const apiKey = cleanText(projectConfig.aiVisualApiKey) || fallback.apiKey || "";
  return {
    provider: fallback.provider,
    model: cleanText(projectConfig.aiVisualModel) || fallback.model,
    baseUrl: cleanText(projectConfig.aiVisualBaseUrl) || fallback.baseUrl,
    timeoutMs: normalizeTimeoutMs(projectConfig.aiVisualTimeoutMs, fallback.timeoutMs),
    hasApiKey: Boolean(apiKey || projectConfig.aiVisualHasApiKey || fallback.hasApiKey),
    apiKey
  };
}

export function getCaptchaAiConnectionConfig(projectConfig: ProjectAiConfig): AiConnectionConfig {
  const fallback = getHealingAiConnectionConfig(projectConfig);
  const apiKey = cleanText(projectConfig.aiCaptchaApiKey) || fallback.apiKey || "";
  return {
    provider: cleanText(projectConfig.aiCaptchaProvider) || fallback.provider,
    model: cleanText(projectConfig.aiCaptchaModel) || fallback.model,
    baseUrl: cleanText(projectConfig.aiCaptchaBaseUrl) || fallback.baseUrl,
    timeoutMs: normalizeTimeoutMs(projectConfig.aiCaptchaTimeoutMs, fallback.timeoutMs),
    hasApiKey: Boolean(apiKey || projectConfig.aiCaptchaHasApiKey || fallback.hasApiKey),
    apiKey
  };
}

interface AiChatRequest {
  connection: AiConnectionConfig;
  systemPrompt: string;
  userPrompt: string;
  imageDataUrl?: string;
  allowTextOnlyFallback?: boolean;
}

interface AiHttpResponse {
  ok: boolean;
  status: number;
  text: string;
}

interface AiRequestBodyInput {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  imageDataUrl?: string;
  includeResponseFormat: boolean;
  enableThinking?: boolean;
  stream?: boolean;
  omitTemperature?: boolean;
}

function aiChatEndpoint(connection: AiConnectionConfig): string {
  return `${connection.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function isNodeFetchTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const cause = (error as Error & { cause?: { code?: string } }).cause;
  return (
    error.message.toLowerCase().includes("fetch failed") ||
    ["ECONNRESET", "UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ECONNREFUSED"].includes(cause?.code || "")
  );
}

function normalizeAiTransportErrorMessage(message: string): string {
  const text = String(message || "").trim();
  if (!text) {
    return "AI 请求失败";
  }
  const lower = text.toLowerCase();
  if (
    text.includes("请求超时") ||
    text.includes("超时") ||
    /�{2,}.*ʱ/.test(text) ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("operation has timed out") ||
    lower.includes("abort") ||
    lower.includes("aborted")
  ) {
    return "AI 请求超时";
  }
  if (
    text.includes("无法连接") ||
    text.includes("远程服务器") ||
    lower.includes("connection refused") ||
    lower.includes("actively refused") ||
    lower.includes("econnrefused")
  ) {
    return "AI 服务连接失败";
  }
  if (
    text.includes("远程名称") ||
    lower.includes("enotfound") ||
    lower.includes("name resolution") ||
    lower.includes("no such host") ||
    lower.includes("dns")
  ) {
    return "AI 服务地址解析失败";
  }
  if (
    text.includes("连接被强制关闭") ||
    lower.includes("connection reset") ||
    lower.includes("forcibly closed") ||
    lower.includes("econnreset")
  ) {
    return "AI 服务连接被重置";
  }
  if (text.includes("�")) {
    return "AI 请求失败";
  }
  return text;
}

async function callAiViaPowerShell(input: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<AiHttpResponse> {
  const script = `
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$raw = [Console]::In.ReadToEnd()
$request = $raw | ConvertFrom-Json
$headers = @{
  Authorization = "Bearer $($request.apiKey)"
  "Content-Type" = "application/json"
}
$body = $request.body | ConvertTo-Json -Depth 100 -Compress
try {
  $response = Invoke-WebRequest -Uri $request.url -Method Post -Headers $headers -Body $body -ContentType "application/json" -TimeoutSec $request.timeoutSec -UseBasicParsing
  @{ status = [int]$response.StatusCode; body = [string]$response.Content } | ConvertTo-Json -Depth 20 -Compress
} catch {
  $status = 0
  $content = ""
  if ($_.Exception.Response) {
    try {
      $status = [int]$_.Exception.Response.StatusCode
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
      }
    } catch {}
  }
  @{ status = $status; body = $content; error = $_.Exception.Message } | ConvertTo-Json -Depth 20 -Compress
}
`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("AI 请求超时"));
    }, input.timeoutMs + 3000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      const payload = parseJson<{ status?: number; body?: string; error?: string }>(stdout.trim(), {});
      const status = Number(payload.status || 0);
      if (!status) {
        reject(new Error(normalizeAiTransportErrorMessage(payload.error || stderr.trim() || "AI request failed")));
        return;
      }
      resolve({
        ok: status >= 200 && status < 300,
        status,
        text: payload.body || ""
      });
    });
    child.stdin.end(
      JSON.stringify({
        url: input.url,
        apiKey: input.apiKey,
        timeoutSec: Math.max(1, Math.ceil(input.timeoutMs / 1000)),
        body: input.body
      })
    );
  });
}

async function postAiJson(input: {
  connection: AiConnectionConfig;
  body: Record<string, unknown>;
  signal: AbortSignal;
}): Promise<AiHttpResponse> {
  try {
    const response = await fetch(aiChatEndpoint(input.connection), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: input.body.stream === true ? "text/event-stream" : "application/json",
        authorization: `Bearer ${input.connection.apiKey}`
      },
      signal: input.signal,
      body: JSON.stringify(input.body)
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text()
    };
  } catch (error) {
    if (process.platform === "win32" && isNodeFetchTransportError(error)) {
      return callAiViaPowerShell({
        url: aiChatEndpoint(input.connection),
        apiKey: input.connection.apiKey || "",
        body: input.body,
        timeoutMs: input.connection.timeoutMs || config.AI_DEFAULT_TIMEOUT_MS
      });
    }
    if (error instanceof Error) {
      throw new Error(normalizeAiTransportErrorMessage(error.message));
    }
    throw error;
  }
}

function buildAiRequestBody(input: AiRequestBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      {
        role: "system",
        content: input.systemPrompt
      },
      {
        role: "user",
        content: input.imageDataUrl
          ? [
              { type: "text", text: input.userPrompt },
              { type: "image_url", image_url: { url: input.imageDataUrl } }
            ]
          : input.userPrompt
      }
    ]
  };
  if (!input.omitTemperature) {
    body.temperature = 0.1;
  }
  if (input.includeResponseFormat) {
    body.response_format = { type: "json_object" };
  }
  if (input.enableThinking) {
    body.enable_thinking = true;
  }
  if (input.stream) {
    body.stream = true;
  }
  return body;
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractProviderError(payload: Record<string, unknown>, responseText: string, status: number): string {
  const error = payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : null;
  const nestedError = error?.error && typeof error.error === "object" ? (error.error as Record<string, unknown>) : null;
  const providerCode = pickString(error?.code) || pickString(payload.code) || pickString(payload.Code);
  const providerMessage =
    pickString(error?.message) ||
    pickString(nestedError?.message) ||
    pickString(payload.message) ||
    pickString(payload.Message) ||
    pickString(payload.msg) ||
    pickString(payload.error_description) ||
    pickString(payload.error);
  if (providerMessage) {
    return `AI request failed (${status})${providerCode ? ` [${providerCode}]` : ""}: ${providerMessage}`;
  }
  const plainText = responseText.replace(/\s+/g, " ").trim();
  if (plainText) {
    return `AI request failed (${status}): ${plainText.slice(0, 500)}`;
  }
  return `AI request failed (${status}): empty response`;
}

function shouldRetryWithoutResponseFormat(response: AiHttpResponse): boolean {
  if (![400, 404, 422].includes(response.status)) {
    return false;
  }
  const text = response.text.toLowerCase();
  return (
    !text ||
    text.includes("response_format") ||
    text.includes("json_object") ||
    text.includes("unsupported") ||
    text.includes("invalid parameter") ||
    text.includes("parameter")
  );
}

function shouldRetryWithoutImage(response: AiHttpResponse): boolean {
  if (![400, 404, 415, 422].includes(response.status)) {
    return false;
  }
  const text = response.text.toLowerCase();
  return (
    !text ||
    text.includes("image") ||
    text.includes("vision") ||
    text.includes("multi-modal") ||
    text.includes("multimodal") ||
    text.includes("content") ||
    text.includes("unsupported") ||
    text.includes("invalid parameter") ||
    text.includes("parameter")
  );
}

function shouldRetryWithoutThinking(response: AiHttpResponse): boolean {
  if (![400, 404, 422].includes(response.status)) {
    return false;
  }
  const text = response.text.toLowerCase();
  return (
    !text ||
    text.includes("enable_thinking") ||
    text.includes("thinking") ||
    text.includes("stream") ||
    text.includes("unsupported") ||
    text.includes("invalid parameter") ||
    text.includes("parameter")
  );
}

function extractJsonText(rawText: string): string {
  const text = rawText.trim();
  if (!text) {
    return text;
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return text.slice(firstObject, lastObject + 1);
  }
  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    return text.slice(firstArray, lastArray + 1);
  }
  return text;
}

function isDashScopeThinkingModel(connection: AiConnectionConfig): boolean {
  return (
    connection.baseUrl.toLowerCase().includes("dashscope.aliyuncs.com") &&
    /^glm[-_]/i.test(connection.model)
  );
}

function contentToText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return typeof record.text === "string" ? record.text : "";
        }
        return "";
      })
      .join("\n");
  }
  return String(content || "");
}

function extractStreamContent(responseText: string): string {
  const chunks: string[] = [];
  for (const rawLine of responseText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    const payload = parseJson<Record<string, unknown> | null>(data, null);
    const choices = Array.isArray(payload?.choices) ? (payload?.choices as Array<Record<string, unknown>>) : [];
    const delta = choices[0]?.delta && typeof choices[0].delta === "object" ? (choices[0].delta as Record<string, unknown>) : null;
    const message = choices[0]?.message && typeof choices[0].message === "object" ? (choices[0].message as Record<string, unknown>) : null;
    const content = contentToText(delta?.content ?? message?.content ?? "");
    if (content) {
      chunks.push(content);
    }
  }
  return chunks.join("");
}

function extractAiMessageContent(responseText: string): string {
  const streamContent = extractStreamContent(responseText);
  if (streamContent) {
    return streamContent;
  }
  const payload = parseJson<Record<string, unknown>>(responseText, {});
  const choices = Array.isArray(payload.choices) ? (payload.choices as Array<Record<string, unknown>>) : [];
  const message = choices[0]?.message && typeof choices[0].message === "object" ? (choices[0].message as Record<string, unknown>) : null;
  const delta = choices[0]?.delta && typeof choices[0].delta === "object" ? (choices[0].delta as Record<string, unknown>) : null;
  return contentToText(message?.content ?? delta?.content ?? "");
}

function appendAttemptSummary(message: string, attempts: string[]): string {
  if (!attempts.length) {
    return message;
  }
  return `${message}; request fallback chain: ${attempts.join(" -> ")}`;
}

async function callAiJson<T>(request: AiChatRequest, fallback: T): Promise<T> {
  if (!request.connection.baseUrl || !request.connection.model || !request.connection.apiKey) {
    throw new Error("AI provider is not configured for the current project");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.connection.timeoutMs || config.AI_DEFAULT_TIMEOUT_MS);
  try {
    const attempts: string[] = [];
    const useThinking = isDashScopeThinkingModel(request.connection);
    const send = async (
      label: string,
      options: { includeResponseFormat: boolean; imageDataUrl?: string; enableThinking?: boolean }
    ): Promise<AiHttpResponse> => {
      attempts.push(label);
      return postAiJson({
        connection: request.connection,
        signal: controller.signal,
        body: buildAiRequestBody({
          model: request.connection.model,
          systemPrompt:
            options.includeResponseFormat
              ? request.systemPrompt
              : `${request.systemPrompt}\nReturn valid JSON only. Do not wrap it in markdown.`,
          userPrompt: request.userPrompt,
          imageDataUrl: options.imageDataUrl,
          includeResponseFormat: options.includeResponseFormat,
          enableThinking: options.enableThinking,
          stream: options.enableThinking,
          omitTemperature: useThinking
        })
      });
    };
    let response = await send(
      request.imageDataUrl
        ? useThinking
          ? "thinking+image"
          : "json+image"
        : useThinking
          ? "thinking+text"
          : "json+text",
      {
        includeResponseFormat: !useThinking,
        imageDataUrl: request.imageDataUrl,
        enableThinking: useThinking
      }
    );
    if (!response.ok && shouldRetryWithoutResponseFormat(response)) {
      response = await send(request.imageDataUrl ? "plain+image" : "plain+text", {
        includeResponseFormat: false,
        imageDataUrl: request.imageDataUrl,
        enableThinking: useThinking
      });
    }
    if (!response.ok && request.imageDataUrl && request.allowTextOnlyFallback !== false && shouldRetryWithoutImage(response)) {
      response = await send("plain+text", {
        includeResponseFormat: false,
        imageDataUrl: undefined,
        enableThinking: useThinking
      });
    }
    if (!response.ok && useThinking && shouldRetryWithoutThinking(response)) {
      response = await send("plain+text-no-thinking", {
        includeResponseFormat: false,
        imageDataUrl: undefined,
        enableThinking: false
      });
    }
    const payload = parseJson<Record<string, unknown>>(response.text, {});
    if (!response.ok) {
      throw new Error(appendAttemptSummary(extractProviderError(payload, response.text, response.status), attempts));
    }
    const rawText = extractAiMessageContent(response.text);
    return parseJson<T>(extractJsonText(rawText), fallback);
  } finally {
    clearTimeout(timer);
  }
}

function scoreConfidence(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100));
}

function normalizeAiLocatorType(value: unknown): string {
  const type = String(value || "").trim().toLowerCase().replaceAll("-", "_");
  if (["role", "getbyrole", "get_by_role"].includes(type)) return "get_by_role";
  if (["text", "getbytext", "get_by_text"].includes(type)) return "get_by_text";
  if (["testid", "test_id", "testid", "getbytestid", "get_by_test_id"].includes(type)) return "get_by_test_id";
  if (["xpath", "relative_xpath", "relativexpath"].includes(type)) return "xpath";
  if (type === "css") return "css";
  return type;
}

export async function requestAiLocatorSuggestions(input: {
  projectConfig: ProjectAiConfig;
  action: string;
  stepName?: string | null;
  elementName?: string | null;
  pageUrl: string;
  pageTitle: string;
  elementSnapshot?: Record<string, unknown> | null;
  attempts: Array<Record<string, unknown>>;
  pageText?: string;
  imageDataUrl?: string;
}): Promise<AiLocatorSuggestion[]> {
  const connection = getHealingAiConnectionConfig(input.projectConfig);
  const payload = await callAiJson<{ candidates?: Array<Record<string, unknown>> }>(
    {
      connection,
      systemPrompt:
        "You are a UI locator healing engine. Return JSON only. Suggest stable Playwright locator candidates. Allowed locatorType values, in priority order: get_by_role, get_by_text, get_by_test_id, css, xpath. Do not return natural-language actions outside JSON.",
      userPrompt: JSON.stringify({
        task: "Generate locator candidates for a failed UI step",
        outputContract: {
          candidates: [
            {
              locatorType: "get_by_role | get_by_text | get_by_test_id | css | xpath",
              locatorValue: "string. For get_by_role use JSON like {\"role\":\"button\",\"name\":\"Login\"}",
              confidence: "number from 0 to 100",
              reason: "short reason"
            }
          ]
        },
        confidenceRule: `Only return candidates with confidence >= ${input.projectConfig.aiLocatorConfidenceThreshold}.`,
        action: input.action,
        stepName: input.stepName || "",
        elementName: input.elementName || "",
        pageUrl: input.pageUrl,
        pageTitle: input.pageTitle,
        pageText: (input.pageText || "").slice(0, 4000),
        elementSnapshot: input.elementSnapshot || {},
        attemptedLocators: input.attempts
      }),
      imageDataUrl: input.imageDataUrl
    },
    { candidates: [] }
  );
  return (payload.candidates || [])
    .map((candidate) => ({
      locatorType: normalizeAiLocatorType(candidate.locatorType),
      locatorValue: String(candidate.locatorValue || "").trim(),
      locatorExpression:
        typeof candidate.locatorExpression === "string" ? candidate.locatorExpression.trim() || null : null,
      confidence: scoreConfidence(candidate.confidence, 0),
      reason: typeof candidate.reason === "string" ? candidate.reason.trim() : ""
    }))
    .filter((candidate) => candidate.locatorType && candidate.locatorValue);
}

export async function recognizeCaptchaWithAi(input: {
  projectConfig: ProjectAiConfig;
  imageDataUrl: string;
  pageUrl?: string;
  pageTitle?: string;
  hint?: string;
}): Promise<AiCaptchaRecognition> {
  const connection = getCaptchaAiConnectionConfig(input.projectConfig);
  const payload = await callAiJson<Record<string, unknown>>(
    {
      connection,
      systemPrompt:
        "You are an OCR assistant for captcha recognition. Return JSON only in the shape {\"text\":\"...\",\"confidence\":0-100,\"reason\":\"...\"}. Do not include extra text.",
      userPrompt: JSON.stringify({
        task: "Recognize the captcha text from the provided image",
        pageUrl: input.pageUrl || "",
        pageTitle: input.pageTitle || "",
        hint: input.hint || ""
      }),
      imageDataUrl: input.imageDataUrl,
      allowTextOnlyFallback: false
    },
    {}
  );
  return {
    text: typeof payload.text === "string" ? payload.text.trim() : "",
    confidence: scoreConfidence(payload.confidence, 0),
    reason: typeof payload.reason === "string" ? payload.reason.trim() : "",
    raw: payload
  };
}

export async function testAiModel(input: {
  connection: AiConnectionConfig;
  prompt?: string;
}): Promise<AiModelTestResult> {
  const startAt = Date.now();
  const payload = await callAiJson<Record<string, unknown>>(
    {
      connection: input.connection,
      systemPrompt:
        "你是自动化测试平台的模型连通性检查接口。请仅返回 JSON，格式必须为 {\"ok\":true,\"message\":\"...\"}，其中 message 使用简体中文。",
      userPrompt: JSON.stringify({
        task: "检查当前配置的 AI 模型是否可以正常响应",
        prompt: input.prompt || "请返回 ok=true，并给出一句简短的中文健康检查信息。"
      })
    },
    {}
  );
  const ok = payload.ok === true || String(payload.ok).toLowerCase() === "true";
  return {
    ok,
    provider: input.connection.provider,
    model: input.connection.model,
    latencyMs: Date.now() - startAt,
    message:
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : ok
          ? "AI 模型响应正常。"
          : "AI 模型已返回响应，但健康检查结果未通过。",
    raw: payload
  };
}
