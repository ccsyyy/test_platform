import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { mysqlPool } from "../db/mysql.js";
import { redis } from "../db/redis.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { assertProjectAccess, getProjectIdByRecordingSession } from "../middleware/projectAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { parseJson } from "../utils/json.js";

export const recordingRouter = Router();

recordingRouter.use(requireAuth);

const sessionSchema = z.object({
  projectId: z.number().int().positive(),
  environmentId: z.number().int().positive().optional(),
  startUrl: z.string().url().max(1000),
  browser: z.enum(["chromium", "chrome", "edge"]),
  mode: z.enum(["record", "pick"]).default("record")
});

const eventSchema = z.object({
  sessionNo: z.string().min(1).max(64),
  eventOrder: z.number().int().positive(),
  eventType: z.string().min(1).max(64),
  action: z.string().max(64).optional(),
  url: z.string().url().max(1000).optional(),
  elementSnapshot: z.record(z.string(), z.unknown()).optional(),
  locators: z.array(z.record(z.string(), z.unknown())).optional(),
  inputValueMasked: z.string().max(1000).optional(),
  eventTime: z.string().datetime().optional()
});

recordingRouter.get(
  "/recording-sessions",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.query.projectId);
    await assertProjectAccess(projectId, request.user!);
    const status = typeof request.query.status === "string" ? request.query.status : "";
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize) || 10));
    const offset = (page - 1) * pageSize;
    const [countRows] = await mysqlPool.query(
      `
      SELECT COUNT(*) AS total
      FROM tp_recording_session s
      WHERE (? = 0 OR s.project_id = ?)
        AND (? = '' OR s.status = ?)
      `,
      [Number.isFinite(projectId) ? projectId : 0, Number.isFinite(projectId) ? projectId : 0, status, status]
    );
    const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0);
    const [rows] = await mysqlPool.query(
      `
      SELECT s.id, s.session_no AS sessionNo, s.project_id AS projectId,
        p.project_name AS projectName,
        s.environment_id AS environmentId, s.start_url AS startUrl, s.browser,
        s.mode, s.status, s.created_by AS createdBy, s.started_at AS startedAt,
        s.stopped_at AS stoppedAt, s.created_at AS createdAt, s.updated_at AS updatedAt,
        u.username AS createdByName, env.env_name AS environmentName,
        COUNT(e.id) AS eventCount
      FROM tp_recording_session s
      JOIN tp_project p ON p.id = s.project_id
      LEFT JOIN sys_user u ON u.id = s.created_by
      LEFT JOIN tp_environment env ON env.id = s.environment_id
      LEFT JOIN tp_recording_event e ON e.session_id = s.id
      WHERE (? = 0 OR s.project_id = ?)
        AND (? = '' OR s.status = ?)
      GROUP BY s.id
      ORDER BY s.id DESC
      LIMIT ? OFFSET ?
      `,
      [
        Number.isFinite(projectId) ? projectId : 0,
        Number.isFinite(projectId) ? projectId : 0,
        status,
        status,
        pageSize,
        offset
      ]
    );
    response.json({
      code: 200,
      message: "success",
      data: {
        items: rows,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    });
  })
);

recordingRouter.get(
  "/recording-sessions/:sessionNo/events",
  asyncHandler(async (request, response) => {
    const sessionNo = String(request.params.sessionNo);
    const projectId = await getProjectIdByRecordingSession(sessionNo);
    if (!projectId) {
      throw new HttpError(404, "录制会话不存在");
    }
    await assertProjectAccess(projectId, request.user!);
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize) || 10));
    const offset = (page - 1) * pageSize;
    const [countRows] = await mysqlPool.query(
      `
      SELECT COUNT(*) AS total
      FROM tp_recording_event e
      JOIN tp_recording_session s ON s.id = e.session_id
      WHERE s.session_no = ?
      `,
      [sessionNo]
    );
    const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0);
    const [rows] = await mysqlPool.query(
      `
      SELECT e.id, e.event_order AS eventOrder, e.event_type AS eventType,
        e.action, e.url, e.element_snapshot_json AS elementSnapshot,
        e.locators_json AS locators, e.input_value_masked AS inputValueMasked,
        e.event_time AS eventTime, e.created_at AS createdAt
      FROM tp_recording_event e
      JOIN tp_recording_session s ON s.id = e.session_id
      WHERE s.session_no = ?
      ORDER BY e.event_order ASC
      LIMIT ? OFFSET ?
      `,
      [sessionNo, pageSize, offset]
    );
    response.json({
      code: 200,
      message: "success",
      data: {
        items: rows,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    });
  })
);

const materializeSchema = z.object({
  pageName: z.string().min(1).max(200).optional(),
  caseName: z.string().min(1).max(200).optional(),
  caseCode: z.string().min(1).max(64).optional()
});

interface RecordingEventRow {
  eventOrder: number;
  eventType: string;
  action: string | null;
  url: string | null;
  elementSnapshot: unknown;
  locators: unknown;
  inputValueMasked: string | null;
}

interface DraftEvent {
  eventOrder: number;
  action: string;
  url: string;
  locatorType: string;
  locatorValue: string;
  elementName: string;
  elementType: string;
  inputValueMasked: string | null;
  snapshot: Record<string, unknown>;
  locators: Array<Record<string, unknown>>;
}

interface MaterializedCaseStep {
  stepName: string;
  action: string;
  elementId: number | null;
  stepDsl: Record<string, unknown>;
  locatorSnapshot: Array<Record<string, unknown>> | null;
}

const ELEMENT_NAME_MAX_LENGTH = 200;
const STEP_NAME_MAX_LENGTH = 200;
const IMPLICIT_NAVIGATION_ACTIONS = new Set(["click", "dblclick", "rightclick", "press", "check", "uncheck", "select"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeDisplayText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateDisplayText(value: unknown, maxLength: number): string {
  const normalized = normalizeDisplayText(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, Math.max(1, maxLength)).trim();
}

function testIdFromSnapshot(snapshot: Record<string, unknown>): string | undefined {
  return typeof snapshot.testId === "string" && snapshot.testId.length > 0
    ? snapshot.testId
    : undefined;
}

function elementTypeFromSnapshot(snapshot: Record<string, unknown>, action: string): string {
  const tagName = typeof snapshot.tagName === "string" ? snapshot.tagName : "";
  const type = typeof snapshot.type === "string" ? snapshot.type : "";
  if (type === "checkbox") return "checkbox";
  if (tagName === "input" && type === "password") return "password";
  if (tagName === "input") return "input";
  if (tagName === "select") return "select";
  if (action === "click") return "button";
  return tagName || "element";
}

function readableElementName(testId: string, action: string): string {
  const words = testId
    .replace(/^demo-/, "")
    .split(/[-_:]+/)
    .filter(Boolean)
    .join(" ");
  const suffix = action === "fill" ? "输入框" : action === "click" ? "按钮" : "元素";
  return `${words || testId} ${suffix}`;
}

function normalizeAction(row: RecordingEventRow, snapshot: Record<string, unknown>): string {
  const rawAction = String(row.action || row.eventType || "").toLowerCase();
  if (["click", "dblclick", "rightclick", "fill", "select", "check", "uncheck", "press"].includes(rawAction)) {
    return rawAction;
  }
  if (row.eventType === "input" || row.eventType === "change") {
    return snapshot.type === "checkbox" ? "check" : "fill";
  }
  return "click";
}

function normalizeLocator(locator: Record<string, unknown>): Record<string, unknown> | null {
  const locatorType = String(locator.locatorType ?? "").trim();
  const locatorValue = String(locator.locatorValue ?? "").trim();
  if (!locatorType || !locatorValue) {
    return null;
  }
  if (isWeakCssLocator(locatorType, locatorValue)) {
    return null;
  }
  return {
    ...locator,
    locatorType,
    locatorValue
  };
}

function preferredLocatorWeight(locator: Record<string, unknown>, snapshot: Record<string, unknown>): number {
  const locatorType = String(locator.locatorType ?? "").toLowerCase();
  const locatorValue = String(locator.locatorValue ?? "");
  const tagName = typeof snapshot.tagName === "string" ? snapshot.tagName.toLowerCase() : "";
  const inputType = typeof snapshot.type === "string" ? snapshot.type.toLowerCase() : "";
  if (locatorType === "testid" || locatorType === "test-id" || locatorType === "test_id") return 1000;
  if (locatorType === "css" && /\[(data-testid|data-test|data-qa|data-id)=/i.test(locatorValue)) return 980;
  if (locatorType === "css" && /\[name=/i.test(locatorValue)) return 970;
  if (locatorType === "css" && locatorValue.includes("#")) return 960;
  if (["input", "textarea"].includes(tagName) && locatorType === "placeholder") return 930;
  if (tagName === "input" && inputType === "password" && locatorType === "role") return 120;
  if (locatorType === "role") return 900;
  if (locatorType === "label") return 880;
  if (locatorType === "placeholder") return 850;
  if (locatorType === "text") return 700;
  if (locatorType === "relativexpath" || locatorType === "relative_xpath") {
    return /^\/\/?[a-z0-9_-]+\[@/i.test(locatorValue) ? 760 : 620;
  }
  if (locatorType === "compactcss" || locatorType === "compact_css") {
    return /^[a-z0-9_-]+(?:\.[a-z0-9_-]+){1,2}$/i.test(locatorValue) ? 320 : 640;
  }
  if (locatorType === "xpath") return 360;
  if (locatorType === "css") return 400;
  return 500;
}

function snapshotBackfillLocators(snapshot: Record<string, unknown>): Array<Record<string, unknown>> {
  const locators: Array<Record<string, unknown>> = [];
  const tagName = typeof snapshot.tagName === "string" ? snapshot.tagName.trim().toLowerCase() : "";
  const id = typeof snapshot.id === "string" ? snapshot.id.trim() : "";
  const name = typeof snapshot.name === "string" ? snapshot.name.trim() : "";
  const dataId = typeof snapshot.dataId === "string" ? snapshot.dataId.trim() : "";
  const label = typeof snapshot.label === "string" ? snapshot.label.trim() : "";
  const placeholder = typeof snapshot.placeholder === "string" ? snapshot.placeholder.trim() : "";
  const role = typeof snapshot.role === "string" ? snapshot.role.trim().toLowerCase() : "";
  const accessibleName = typeof snapshot.accessibleName === "string" ? snapshot.accessibleName.trim() : "";
  if (tagName && id) {
    const selector = `${tagName}#${id}`;
    locators.push({
      locatorType: "css",
      locatorValue: selector,
      locatorExpression: `page.locator('${selector.replaceAll("'", "\\'")}')`,
      score: 95
    });
  }
  if (tagName && name) {
    const selector = `${tagName}[name="${name.replaceAll('"', '\\"')}"]`;
    locators.push({
      locatorType: "css",
      locatorValue: selector,
      locatorExpression: `page.locator('${selector.replaceAll("'", "\\'")}')`,
      score: 94
    });
  }
  if (tagName && dataId) {
    const selector = `${tagName}[data-id="${dataId.replaceAll('"', '\\"')}"]`;
    locators.push({
      locatorType: "css",
      locatorValue: selector,
      locatorExpression: `page.locator('${selector.replaceAll("'", "\\'")}')`,
      score: 92
    });
  }
  if (label) {
    locators.push({
      locatorType: "label",
      locatorValue: label,
      locatorExpression: `page.getByLabel('${label.replaceAll("'", "\\'")}')`,
      score: 91
    });
  }
  if (placeholder) {
    locators.push({
      locatorType: "placeholder",
      locatorValue: placeholder,
      locatorExpression: `page.getByPlaceholder('${placeholder.replaceAll("'", "\\'")}')`,
      score: 90
    });
  }
  if (role && accessibleName) {
    locators.push({
      locatorType: "role",
      locatorValue: JSON.stringify({ role, name: accessibleName }),
      locatorExpression: `page.getByRole('${role.replaceAll("'", "\\'")}', { name: '${accessibleName.replaceAll("'", "\\'")}' })`,
      score: role === "textbox" ? 70 : 85
    });
  }
  if (accessibleName && !["input", "textarea", "select"].includes(tagName) && accessibleName.length <= 80) {
    locators.push({
      locatorType: "text",
      locatorValue: accessibleName,
      locatorExpression: `page.getByText('${accessibleName.replaceAll("'", "\\'")}')`,
      score: 60
    });
  }
  const compactCss =
    typeof snapshot.compactCssSelector === "string" ? snapshot.compactCssSelector.trim() : "";
  if (compactCss) {
    locators.push({
      locatorType: "compactCss",
      locatorValue: compactCss,
      locatorExpression: `page.locator('${compactCss.replaceAll("'", "\\'")}')`,
      score: 62
    });
  }
  const relativeXPath =
    typeof snapshot.relativeXPath === "string" ? snapshot.relativeXPath.trim() : "";
  if (relativeXPath) {
    locators.push({
      locatorType: "relativeXPath",
      locatorValue: relativeXPath,
      locatorExpression: `page.locator('xpath=${relativeXPath.replaceAll("'", "\\'")}')`,
      score: 58
    });
  }
  return locators;
}

function isWeakCssLocator(locatorType: string, locatorValue: string): boolean {
  if (locatorType.toLowerCase() !== "css") {
    return false;
  }
  const value = locatorValue.toLowerCase();
  if (/(^|[ >])(?:wujie-app|micro-app)(?:$|[ >.#:[\]])/.test(value)) {
    return true;
  }
  const parts = value.split(">").map((part) => part.trim()).filter(Boolean);
  const nthCount = (value.match(/:nth-of-type\(/g) || []).length;
  return parts.length >= 3 && nthCount >= 2 && !/[#[]/.test(value);
}

function isDynamicValueCssLocator(locatorType: string, locatorValue: string): boolean {
  return canonicalLocatorType(locatorType) === "css" && /\[value=(['"]).+\1\]/i.test(locatorValue);
}

function isWeakCompactCssLocator(locatorType: string, locatorValue: string): boolean {
  if (canonicalLocatorType(locatorType) !== "compactcss") {
    return false;
  }
  const value = locatorValue.trim();
  return Boolean(value) && !/[#[]/.test(value) && /^[a-z0-9_-]+(?:\.[a-z0-9_-]+){0,2}$/i.test(value);
}

function isRedundantFormControlClick(action: string, snapshot: Record<string, unknown>): boolean {
  if (action !== "click") {
    return false;
  }
  const tagName = typeof snapshot.tagName === "string" ? snapshot.tagName.toLowerCase() : "";
  const inputType = typeof snapshot.type === "string" ? snapshot.type.toLowerCase() : "";
  if (tagName === "textarea" || tagName === "select") {
    return true;
  }
  return tagName === "input" && !["button", "submit", "reset"].includes(inputType);
}

function canonicalLocatorType(locatorType: string): string {
  const value = locatorType.trim().toLowerCase();
  if (value === "compactcss" || value === "compact_css") {
    return "compactcss";
  }
  if (value === "relativexpath" || value === "relative_xpath") {
    return "relativexpath";
  }
  if (value === "test-id" || value === "test_id") {
    return "testid";
  }
  return value;
}

function dedupeLocators(locators: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const deduped: Array<Record<string, unknown>> = [];
  for (const locator of locators) {
    const locatorType = String(locator.locatorType ?? "").trim();
    const locatorValue = String(locator.locatorValue ?? "").trim();
    if (!locatorType || !locatorValue) {
      continue;
    }
    const key = `${canonicalLocatorType(locatorType)}::${locatorValue}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...locator,
      locatorType,
      locatorValue
    });
  }
  return deduped;
}

function locatorIdentity(locator: Record<string, unknown>): string {
  return `${canonicalLocatorType(String(locator.locatorType ?? ""))}::${String(locator.locatorValue ?? "").trim()}`;
}

function isReusableLocator(locator: Record<string, unknown>, snapshot: Record<string, unknown>): boolean {
  const locatorType = String(locator.locatorType ?? "").trim();
  const locatorValue = String(locator.locatorValue ?? "").trim();
  const canonicalType = canonicalLocatorType(locatorType);
  const tagName = typeof snapshot.tagName === "string" ? snapshot.tagName.toLowerCase() : "";

  if (!locatorType || !locatorValue) {
    return false;
  }
  if (isWeakCssLocator(locatorType, locatorValue) || isDynamicValueCssLocator(locatorType, locatorValue)) {
    return false;
  }
  if (isWeakCompactCssLocator(locatorType, locatorValue)) {
    return false;
  }
  if (canonicalType === "text") {
    return tagName !== "input" && tagName !== "textarea" && tagName !== "select" && locatorValue.length <= 80;
  }
  if (canonicalType === "role") {
    const roleValue = parseJson<Record<string, unknown>>(locatorValue, {});
    return typeof roleValue.name === "string" && roleValue.name.trim().length > 0;
  }
  return true;
}

function preferredReusableLocator(
  snapshot: Record<string, unknown>,
  locators: Array<Record<string, unknown>>
): Record<string, unknown> | null {
  const reusable = locators.filter((locator) => isReusableLocator(locator, snapshot));
  if (!reusable.length) {
    return null;
  }
  return reusable
    .slice()
    .sort(
      (a, b) =>
        preferredLocatorWeight(b, snapshot) - preferredLocatorWeight(a, snapshot) ||
        Number(b.score ?? 0) - Number(a.score ?? 0)
    )[0] ?? null;
}

function sameLogicalDraftTarget(left: DraftEvent, right: DraftEvent): boolean {
  if (left.locatorType === right.locatorType && left.locatorValue === right.locatorValue) {
    return true;
  }
  const leftSet = new Set(left.locators.map(locatorIdentity));
  for (const locator of right.locators) {
    if (leftSet.has(locatorIdentity(locator))) {
      return true;
    }
  }
  return false;
}

function canMergeSequentialInput(previous: DraftEvent | undefined, next: DraftEvent): boolean {
  if (!previous) {
    return false;
  }
  if (!["fill", "select"].includes(previous.action) || previous.action !== next.action) {
    return false;
  }
  if (previous.url !== next.url) {
    return false;
  }
  return sameLogicalDraftTarget(previous, next);
}

function hasCaptchaKeyword(value: unknown): boolean {
  return /captcha|verify\s*code|verification\s*code|验证码|校验码|图形码|安全码/i.test(String(value || ""));
}

const DYNAMIC_CAPTCHA_QUERY_KEYS = new Set(["uuid", "token", "ts", "timestamp", "t", "r", "rand", "random", "nonce", "_"]);

function decodeLocatorText(value: string): string {
  return value
    .replace(/\\\//g, "/")
    .replace(/\\"/g, "\"")
    .replace(/\\([?=&])/g, "$1")
    .trim();
}

function escapeCssAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function buildStableCaptchaCssLocator(locatorValue: string): string | null {
  const normalizedValue = decodeLocatorText(locatorValue);
  const match = normalizedValue.match(/^([a-z0-9_-]+)\[src=(['"])(.+?)\2\]$/i);
  if (!match) {
    return null;
  }
  const tagName = match[1] || "img";
  const rawSrc = match[3] || "";
  if (!hasCaptchaKeyword(rawSrc)) {
    return null;
  }
  try {
    const url = new URL(rawSrc, "https://captcha.local");
    const fragments: string[] = [];
    if (url.pathname) {
      fragments.push(url.pathname);
    }
    for (const [key, value] of url.searchParams.entries()) {
      if (!value || DYNAMIC_CAPTCHA_QUERY_KEYS.has(key.toLowerCase())) {
        continue;
      }
      fragments.push(`${key}=${value}`);
    }
    const stableFragments = [...new Set(fragments.filter(Boolean))];
    if (!stableFragments.length) {
      stableFragments.push("captcha");
    }
    return `${tagName}${stableFragments.map((fragment) => `[src*="${escapeCssAttributeValue(fragment)}"]`).join("")}`;
  } catch {
    const [pathPart] = rawSrc.split("?");
    const fragment = pathPart?.trim() || "captcha";
    return `${tagName}[src*="${escapeCssAttributeValue(fragment)}"]`;
  }
}

function normalizeSnapshotLocator(value: unknown): Record<string, unknown> | null {
  const locator = asRecord(value);
  if (!Object.keys(locator).length) {
    return null;
  }
  return normalizeLocator(locator);
}

function normalizeCaptchaImageLocator(value: unknown): Record<string, unknown> | null {
  const locator = normalizeSnapshotLocator(value);
  if (!locator) {
    return null;
  }
  if (canonicalLocatorType(String(locator.locatorType ?? "")) !== "css") {
    return locator;
  }
  const stableLocatorValue = buildStableCaptchaCssLocator(String(locator.locatorValue ?? ""));
  if (!stableLocatorValue || stableLocatorValue === String(locator.locatorValue ?? "").trim()) {
    return locator;
  }
  return {
    ...locator,
    locatorValue: stableLocatorValue,
    locatorExpression: `page.locator('${stableLocatorValue.replaceAll("'", "\\'")}')`,
    score: typeof locator.score === "number" ? Math.max(locator.score, 96) : 96
  };
}

function isLikelyCaptchaRefreshLocator(locator: Record<string, unknown>): boolean {
  const locatorType = canonicalLocatorType(String(locator.locatorType ?? ""));
  if (["css", "xpath", "relativexpath", "compactcss", "testid"].includes(locatorType)) {
    return true;
  }
  return hasCaptchaKeyword(locator.locatorValue);
}

function normalizeCaptchaRefreshLocator(value: unknown): Record<string, unknown> | null {
  const locator = normalizeSnapshotLocator(value);
  if (!locator || !isLikelyCaptchaRefreshLocator(locator)) {
    return null;
  }
  return locator;
}

function isCaptchaDraft(snapshot: Record<string, unknown>, draft: DraftEvent): boolean {
  return (
    Boolean(normalizeSnapshotLocator(snapshot.captchaImageLocator)) ||
    [
      snapshot.label,
      snapshot.ariaLabel,
      snapshot.accessibleName,
      snapshot.placeholder,
      snapshot.name,
      snapshot.id,
      snapshot.className,
      snapshot.text,
      draft.elementName,
      draft.locatorValue
    ].some(hasCaptchaKeyword)
  );
}

function buildDraftStepParams(draft: DraftEvent): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (draft.action === "fill" || draft.action === "select") {
    params.value = draft.inputValueMasked ?? "";
  }
  if (draft.action === "fill" && isCaptchaDraft(draft.snapshot, draft)) {
    params.aiCaptcha = true;
    const imageLocator = normalizeCaptchaImageLocator(draft.snapshot.captchaImageLocator);
    const refreshLocator = normalizeCaptchaRefreshLocator(draft.snapshot.captchaRefreshLocator);
    if (imageLocator) {
      params.captchaImageLocator = imageLocator;
    }
    if (refreshLocator) {
      params.captchaRefreshLocator = refreshLocator;
    }
    if (typeof draft.snapshot.captchaHint === "string" && draft.snapshot.captchaHint.trim()) {
      params.aiCaptchaHint = draft.snapshot.captchaHint.trim();
    }
  }
  return params;
}

function buildLocatorSnapshot(draft: DraftEvent): Array<Record<string, unknown>> {
  return draft.locators.map((locator, index) => ({
    locatorType: String(locator.locatorType ?? ""),
    locatorValue: String(locator.locatorValue ?? ""),
    locatorExpression: typeof locator.locatorExpression === "string" ? locator.locatorExpression : null,
    score: typeof locator.score === "number" ? locator.score : 0,
    isPrimary: Boolean(locator.isPrimary) || index === 0
  }));
}

function createGotoMaterializedStep(stepName: string, urlPattern: string): MaterializedCaseStep {
  return {
    stepName,
    action: "goto",
    elementId: null,
    stepDsl: {
      action: "goto",
      params: {
        url: urlPattern
      }
    },
    locatorSnapshot: null
  };
}

function createDraftMaterializedStep(draft: DraftEvent, elementId: number | null): MaterializedCaseStep {
  return {
    stepName: truncateDisplayText(`${draft.action} ${draft.elementName}`, STEP_NAME_MAX_LENGTH),
    action: draft.action,
    elementId,
    stepDsl: {
      action: draft.action,
      params: buildDraftStepParams(draft)
    },
    locatorSnapshot: buildLocatorSnapshot(draft)
  };
}

function attachImplicitNavigationWait(step: MaterializedCaseStep | undefined, nextUrlPattern: string): boolean {
  if (!step || !IMPLICIT_NAVIGATION_ACTIONS.has(step.action.toLowerCase())) {
    return false;
  }
  const currentParams =
    step.stepDsl.params && typeof step.stepDsl.params === "object" && !Array.isArray(step.stepDsl.params)
      ? (step.stepDsl.params as Record<string, unknown>)
      : {};
  step.stepDsl = {
    ...step.stepDsl,
    params: {
      ...currentParams,
      waitForUrlPattern: nextUrlPattern
    }
  };
  return true;
}

function isImmediateDuplicateDraft(previous: DraftEvent | undefined, next: DraftEvent): boolean {
  if (!previous) {
    return false;
  }
  if (previous.action !== next.action || previous.url !== next.url) {
    return false;
  }
  if (!sameLogicalDraftTarget(previous, next)) {
    return false;
  }
  return String(previous.inputValueMasked ?? "") === String(next.inputValueMasked ?? "");
}

function primaryLocatorFromEvent(
  snapshot: Record<string, unknown>,
  locators: Array<Record<string, unknown>>
): { locatorType: string; locatorValue: string; locators: Array<Record<string, unknown>> } | null {
  const rawLocators = dedupeLocators([...locators, ...snapshotBackfillLocators(snapshot)]);
  const normalizedLocators = rawLocators.filter(
    (locator) => !isWeakCssLocator(String(locator.locatorType), String(locator.locatorValue))
  );
  const testId = testIdFromSnapshot(snapshot);
  if (testId) {
    return {
      locatorType: "testId",
      locatorValue: testId,
      locators: [
        {
          locatorType: "testId",
          locatorValue: testId,
          locatorExpression: `page.getByTestId('${testId.replaceAll("'", "\\'")}')`,
          score: 100,
          isPrimary: true
        },
        ...normalizedLocators.map((locator) => ({ ...locator, isPrimary: false }))
      ]
    };
  }
  const rankedLocators = (normalizedLocators.length ? normalizedLocators : rawLocators)
    .slice()
    .sort(
      (a, b) =>
        preferredLocatorWeight(b, snapshot) - preferredLocatorWeight(a, snapshot) ||
        Number(b.score ?? 0) - Number(a.score ?? 0)
    );
  const primary = rankedLocators[0];
  if (!primary) {
    return null;
  }
  const locatorType = String(primary.locatorType);
  const locatorValue = String(primary.locatorValue);
  return {
    locatorType,
    locatorValue,
    locators: rankedLocators.map((locator) => ({
      ...locator,
      isPrimary: String(locator.locatorType) === locatorType && String(locator.locatorValue) === locatorValue
    }))
  };
}

function readableElementNameBySnapshot(
  snapshot: Record<string, unknown>,
  locatorValue: string,
  action: string
): string {
  const source =
    (typeof snapshot.label === "string" ? snapshot.label.trim() : "") ||
    (typeof snapshot.ariaLabel === "string" ? snapshot.ariaLabel.trim() : "") ||
    testIdFromSnapshot(snapshot) ||
    (typeof snapshot.placeholder === "string" ? snapshot.placeholder : "") ||
    (typeof snapshot.text === "string" ? snapshot.text.trim() : "") ||
    (typeof snapshot.name === "string" ? snapshot.name : "") ||
    (typeof snapshot.id === "string" ? snapshot.id : "") ||
    locatorValue;
  const words = source
    .replace(/^demo-/, "")
    .split(/[-_:]+/)
    .filter(Boolean)
    .join(" ");
  const suffix = action === "fill" ? "输入框" : action === "click" ? "按钮" : action === "check" ? "勾选项" : "元素";
  return truncateDisplayText(`${words || locatorValue} ${suffix}`, ELEMENT_NAME_MAX_LENGTH);
}

function normalizeDraftEvents(rows: RecordingEventRow[]): DraftEvent[] {
  const drafts: DraftEvent[] = [];

  for (const row of rows) {
    const snapshot = asRecord(parseJson(row.elementSnapshot, {}));
    const locators = parseJson<Array<Record<string, unknown>>>(row.locators, []);
    const primaryLocator = primaryLocatorFromEvent(snapshot, locators);
    if (!primaryLocator) {
      continue;
    }

    const action = normalizeAction(row, snapshot);
    const nextDraft: DraftEvent = {
      eventOrder: row.eventOrder,
      action,
      url: row.url ?? "",
      locatorType: primaryLocator.locatorType,
      locatorValue: primaryLocator.locatorValue,
      elementName: readableElementNameBySnapshot(snapshot, primaryLocator.locatorValue, action),
      elementType: elementTypeFromSnapshot(snapshot, action),
      inputValueMasked: row.inputValueMasked,
      snapshot,
      locators: primaryLocator.locators
    };

    if (canMergeSequentialInput(drafts[drafts.length - 1], nextDraft)) {
      const previous = drafts[drafts.length - 1];
      previous.eventOrder = nextDraft.eventOrder;
      previous.inputValueMasked = nextDraft.inputValueMasked;
      previous.snapshot = nextDraft.snapshot;
      previous.locatorType = nextDraft.locatorType;
      previous.locatorValue = nextDraft.locatorValue;
      previous.locators = nextDraft.locators;
      previous.elementName = nextDraft.elementName;
      previous.elementType = nextDraft.elementType;
      continue;
    }

    if (isImmediateDuplicateDraft(drafts[drafts.length - 1], nextDraft)) {
      const previous = drafts[drafts.length - 1];
      previous.eventOrder = nextDraft.eventOrder;
      previous.inputValueMasked = nextDraft.inputValueMasked;
      previous.snapshot = nextDraft.snapshot;
      previous.locatorType = nextDraft.locatorType;
      previous.locatorValue = nextDraft.locatorValue;
      previous.locators = nextDraft.locators;
      previous.elementName = nextDraft.elementName;
      previous.elementType = nextDraft.elementType;
      continue;
    }
    drafts.push(nextDraft);
  }

  return drafts;
}

function parseRecordingUrl(value: string | null | undefined, fallback: string): URL {
  try {
    return new URL(value || fallback);
  } catch {
    return new URL(fallback);
  }
}

function recordingUrlPattern(url: URL): string {
  return `${url.pathname || "/"}${url.search || ""}${url.hash || ""}`;
}

function snapshotPageTitle(snapshot?: Record<string, unknown> | null): string | undefined {
  const directTitle = typeof snapshot?.pageTitle === "string" ? snapshot.pageTitle.trim() : "";
  const pageInfo =
    snapshot?.pageInfo && typeof snapshot.pageInfo === "object" && !Array.isArray(snapshot.pageInfo)
      ? (snapshot.pageInfo as Record<string, unknown>)
      : null;
  const nestedTitle = typeof pageInfo?.title === "string" ? pageInfo.title.trim() : "";
  const title = directTitle || nestedTitle;
  return title || undefined;
}

function safePageName(name: string): string {
  return name.trim().slice(0, 200) || "录制页面";
}

function recordingPageName(
  url: URL,
  snapshot?: Record<string, unknown> | null,
  customName?: string
): string {
  if (customName?.trim()) {
    return safePageName(customName);
  }
  const title = snapshotPageTitle(snapshot);
  if (title) {
    return safePageName(title);
  }
  return safePageName(`录制页面 ${recordingUrlPattern(url)}`);
}

async function upsertPage(input: {
  connection: Awaited<ReturnType<typeof mysqlPool.getConnection>>;
  projectId: number;
  pageName: string;
  urlPattern: string;
  userId?: number;
}): Promise<number> {
  const [existing] = await input.connection.query(
    "SELECT id FROM tp_page WHERE project_id = ? AND url_pattern = ? LIMIT 1",
    [input.projectId, input.urlPattern]
  );
  const page = (existing as Array<{ id: number }>)[0];
  if (page) {
    await input.connection.query(
      "UPDATE tp_page SET page_name = ?, url_pattern = ?, updated_at = NOW(3) WHERE id = ?",
      [input.pageName, input.urlPattern, page.id]
    );
    return page.id;
  }

  const [sameNameRows] = await input.connection.query(
    "SELECT id FROM tp_page WHERE project_id = ? AND page_name = ? LIMIT 1",
    [input.projectId, input.pageName]
  );
  const sameNamePage = (sameNameRows as Array<{ id: number }>)[0];
  if (sameNamePage) {
    await input.connection.query(
      "UPDATE tp_page SET url_pattern = ?, updated_at = NOW(3) WHERE id = ?",
      [input.urlPattern, sameNamePage.id]
    );
    return sameNamePage.id;
  }

  const [result] = await input.connection.query(
    `
    INSERT INTO tp_page (project_id, page_name, url_pattern, description, created_by)
    VALUES (?, ?, ?, '由录制会话自动生成', ?)
    `,
    [input.projectId, input.pageName, input.urlPattern, input.userId ?? null]
  );
  return Number((result as { insertId: number }).insertId);
}

async function upsertElementFromDraft(input: {
  connection: Awaited<ReturnType<typeof mysqlPool.getConnection>>;
  projectId: number;
  pageId: number;
  draft: DraftEvent;
  userId?: number;
}): Promise<number> {
  const dedupedLocators = dedupeLocators(input.draft.locators);
  const reusableLocator = preferredReusableLocator(input.draft.snapshot, dedupedLocators);
  let found: { id: number } | undefined;
  if (reusableLocator) {
    const [existing] = await input.connection.query(
      `
      SELECT e.id
      FROM tp_element e
      JOIN tp_element_locator l ON l.element_id = e.id
      WHERE e.project_id = ? AND e.page_id = ? AND l.locator_type = ?
        AND l.locator_value = ? AND e.status <> 0
      LIMIT 1
      `,
      [
        input.projectId,
        input.pageId,
        String(reusableLocator.locatorType ?? ""),
        String(reusableLocator.locatorValue ?? "")
      ]
    );
    found = (existing as Array<{ id: number }>)[0];
  }
  const attributes = input.draft.locatorType === "testId"
    ? {
        ...input.draft.snapshot,
        testId: input.draft.locatorValue
      }
    : input.draft.snapshot;
  const elementName = truncateDisplayText(input.draft.elementName, ELEMENT_NAME_MAX_LENGTH) || "Recorded element";
  let elementId: number;

  if (found) {
    elementId = found.id;
    await input.connection.query(
      `
      UPDATE tp_element
      SET element_name = ?, element_type = ?, default_action = ?, source_url = ?,
        attributes_json = CAST(? AS JSON), valid_status = 1, updated_at = NOW(3)
      WHERE id = ?
      `,
      [
        elementName,
        input.draft.elementType,
        input.draft.action,
        input.draft.url,
        JSON.stringify(attributes),
        elementId
      ]
    );
    await input.connection.query(
      "DELETE FROM tp_element_locator WHERE element_id = ? AND COALESCE(source, 'recording') IN ('recording', 'manual')",
      [elementId]
    );
  } else {
    const [result] = await input.connection.query(
      `
      INSERT INTO tp_element (
        project_id, page_id, element_name, element_type, default_action,
        source_url, text_content, tag_name, attributes_json, valid_status, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1, ?)
      `,
      [
        input.projectId,
        input.pageId,
        elementName,
        input.draft.elementType,
        input.draft.action,
        input.draft.url,
        typeof input.draft.snapshot.text === "string" ? input.draft.snapshot.text : null,
        typeof input.draft.snapshot.tagName === "string" ? input.draft.snapshot.tagName : null,
        JSON.stringify(attributes),
        input.userId ?? null
      ]
    );
    elementId = Number((result as { insertId: number }).insertId);
  }

  let primaryLocatorId: number | null = null;
  for (const [index, locator] of dedupedLocators.entries()) {
    const locatorType = String(locator.locatorType ?? "css");
    const locatorValue = String(locator.locatorValue ?? "");
    if (!locatorValue) {
      continue;
    }
    const isPrimary = Boolean(locator.isPrimary) || index === 0;
    const [locatorResult] = await input.connection.query(
      `
      INSERT INTO tp_element_locator (
        element_id, locator_type, locator_value, locator_expression,
        score, is_primary, is_unique, is_visible, is_actionable,
        source, status, priority, confidence
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, 'recording', 'active', ?, ?)
      `,
      [
        elementId,
        locatorType,
        locatorValue,
        typeof locator.locatorExpression === "string" ? locator.locatorExpression : null,
        typeof locator.score === "number" ? locator.score : 0,
        isPrimary ? 1 : 0,
        index + 1,
        typeof locator.score === "number" ? locator.score : 0
      ]
    );
    if (isPrimary && !primaryLocatorId) {
      primaryLocatorId = Number((locatorResult as { insertId: number }).insertId);
    }
  }
  if (primaryLocatorId) {
    await input.connection.query("UPDATE tp_element SET primary_locator_id = ? WHERE id = ?", [
      primaryLocatorId,
      elementId
    ]);
  }
  return elementId;
}

async function archiveCaseSteps(input: {
  connection: Awaited<ReturnType<typeof mysqlPool.getConnection>>;
  caseId: number;
}): Promise<void> {
  await input.connection.query(
    `
    UPDATE tp_case_step
    SET status = 0,
      step_order = id + 1000000,
      updated_at = NOW(3)
    WHERE case_id = ? AND status = 1
    `,
    [input.caseId]
  );
}

recordingRouter.post(
  "/recording-sessions",
  asyncHandler(async (request, response) => {
    const body = sessionSchema.parse(request.body);
    await assertProjectAccess(body.projectId, request.user!, "record");
    const sessionNo = `rec_${Date.now()}_${uuidv4().slice(0, 8)}`;
    await mysqlPool.query(
      `
      INSERT INTO tp_recording_session (
        session_no, project_id, environment_id, start_url, browser,
        mode, status, created_by, started_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'created', ?, NOW(3))
      `,
      [
        sessionNo,
        body.projectId,
        body.environmentId ?? null,
        body.startUrl,
        body.browser,
        body.mode,
        request.user?.id
      ]
    );
    await redis.hmset(`test-platform:recording:${sessionNo}`, {
      projectId: String(body.projectId),
      startUrl: body.startUrl,
      browser: body.browser,
      mode: body.mode,
      status: "created"
    });
    await redis.expire(`test-platform:recording:${sessionNo}`, 60 * 60 * 4);

    response.status(201).json({
      code: 201,
      message: "created",
      data: { sessionNo }
    });
  })
);

recordingRouter.post(
  "/recording-events",
  asyncHandler(async (request, response) => {
    const body = eventSchema.parse(request.body);
    const [sessionRows] = await mysqlPool.query(
      "SELECT id, project_id AS projectId FROM tp_recording_session WHERE session_no = ? LIMIT 1",
      [body.sessionNo]
    );
    const session = (sessionRows as Array<{ id: number; projectId: number }>)[0];
    if (!session) {
      response.status(404).json({ code: 404, message: "录制会话不存在", data: null });
      return;
    }
    await assertProjectAccess(session.projectId, request.user!, "record");

    await mysqlPool.query(
      `
      INSERT INTO tp_recording_event (
        session_id, event_order, event_type, action, url,
        element_snapshot_json, locators_json, input_value_masked, event_time
      )
      VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?)
      `,
      [
        session.id,
        body.eventOrder,
        body.eventType,
        body.action ?? null,
        body.url ?? null,
        JSON.stringify(body.elementSnapshot ?? {}),
        JSON.stringify(body.locators ?? []),
        body.inputValueMasked ?? null,
        body.eventTime ? new Date(body.eventTime) : null
      ]
    );
    await redis.rpush(
      `test-platform:recording:${body.sessionNo}:events`,
      JSON.stringify(body)
    );
    await redis.expire(`test-platform:recording:${body.sessionNo}:events`, 60 * 60 * 4);

    response.status(201).json({ code: 201, message: "created", data: null });
  })
);

recordingRouter.post(
  "/recording-sessions/:sessionNo/stop",
  asyncHandler(async (request, response) => {
    const sessionNo = String(request.params.sessionNo);
    const projectId = await getProjectIdByRecordingSession(sessionNo);
    if (!projectId) {
      response.status(404).json({ code: 404, message: "录制会话不存在", data: null });
      return;
    }
    await assertProjectAccess(projectId, request.user!, "record");
    const [result] = await mysqlPool.query(
      `
      UPDATE tp_recording_session
      SET status = CASE WHEN status = 'materialized' THEN status ELSE 'stopped' END,
        stopped_at = COALESCE(stopped_at, NOW(3)),
        updated_at = NOW(3)
      WHERE session_no = ?
      `,
      [sessionNo]
    );
    const affectedRows = Number((result as { affectedRows: number }).affectedRows);
    response.json({
      code: 200,
      message: "success",
      data: {
        sessionNo,
        updated: affectedRows > 0
      }
    });
  })
);

recordingRouter.delete(
  "/recording-sessions/:sessionNo",
  asyncHandler(async (request, response) => {
    const sessionNo = String(request.params.sessionNo);
    const projectId = await getProjectIdByRecordingSession(sessionNo);
    if (!projectId) {
      throw new HttpError(404, "录制会话不存在");
    }
    await assertProjectAccess(projectId, request.user!, "record");

    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      const [sessionRows] = await connection.query(
        `
        SELECT s.id, s.status, COUNT(e.id) AS eventCount
        FROM tp_recording_session s
        LEFT JOIN tp_recording_event e ON e.session_id = s.id
        WHERE s.session_no = ?
        GROUP BY s.id
        LIMIT 1
        `,
        [sessionNo]
      );
      const session = (sessionRows as Array<{ id: number; status: string; eventCount: number }>)[0];
      if (!session) {
        throw new HttpError(404, "录制会话不存在");
      }
      const isInvalid = true;
      if (!isInvalid) {
        throw new HttpError(400, "只能删除无事件、已创建或失败的无效录制会话");
      }

      await connection.query("DELETE FROM tp_recording_event WHERE session_id = ?", [session.id]);
      await connection.query("DELETE FROM tp_recording_session WHERE id = ?", [session.id]);
      await connection.commit();
      response.json({ code: 200, message: "success", data: { sessionNo } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

recordingRouter.post(
  "/recording-sessions/:sessionNo/materialize",
  asyncHandler(async (request, response) => {
    const sessionNo = String(request.params.sessionNo);
    const projectId = await getProjectIdByRecordingSession(sessionNo);
    if (!projectId) {
      response.status(404).json({ code: 404, message: "录制会话不存在", data: null });
      return;
    }
    await assertProjectAccess(projectId, request.user!, "materialize_recording");
    const body = materializeSchema.parse(request.body);
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      const [sessionRows] = await connection.query(
        `
        SELECT id, session_no AS sessionNo, project_id AS projectId, start_url AS startUrl
        FROM tp_recording_session
        WHERE session_no = ?
        LIMIT 1
        `,
        [sessionNo]
      );
      const session = (sessionRows as Array<{
        id: number;
        sessionNo: string;
        projectId: number;
        startUrl: string;
      }>)[0];
      if (!session) {
        response.status(404).json({ code: 404, message: "录制会话不存在", data: null });
        return;
      }

      const [eventRows] = await connection.query(
        `
        SELECT event_order AS eventOrder, event_type AS eventType, action, url,
          element_snapshot_json AS elementSnapshot, locators_json AS locators,
          input_value_masked AS inputValueMasked
        FROM tp_recording_event
        WHERE session_id = ?
        ORDER BY event_order ASC
        `,
        [session.id]
      );
      const drafts = normalizeDraftEvents(eventRows as RecordingEventRow[]);
      if (drafts.length === 0) {
        response.status(400).json({
          code: 400,
          message: "录制会话没有可物化的有效事件",
          data: null
        });
        return;
      }

      const pageUrl = new URL(session.startUrl);
      const firstPageSnapshot =
        drafts.find(
          (draft) =>
            recordingUrlPattern(parseRecordingUrl(draft.url, session.startUrl)) ===
            recordingUrlPattern(pageUrl)
        )?.snapshot ?? drafts[0]?.snapshot ?? null;
      const pageId = await upsertPage({
        connection,
        projectId: session.projectId,
        pageName: recordingPageName(pageUrl, firstPageSnapshot, body.pageName),
        urlPattern: recordingUrlPattern(pageUrl),
        userId: request.user?.id
      });

      const pageIdByPattern = new Map<string, number>([[recordingUrlPattern(pageUrl), pageId]]);
      const getPageId = async (rawUrl?: string | null, snapshot?: Record<string, unknown> | null) => {
        const url = parseRecordingUrl(rawUrl, session.startUrl);
        const pattern = recordingUrlPattern(url);
        const cachedPageId = pageIdByPattern.get(pattern);
        if (cachedPageId) {
          return cachedPageId;
        }
        const nextPageId = await upsertPage({
          connection,
          projectId: session.projectId,
          pageName: recordingPageName(url, snapshot),
          urlPattern: pattern,
          userId: request.user?.id
        });
        pageIdByPattern.set(pattern, nextPageId);
        return nextPageId;
      };

      const elementIdByLocator = new Map<string, number>();
      for (const draft of drafts) {
        const draftPageId = await getPageId(draft.url, draft.snapshot);
        const elementId = await upsertElementFromDraft({
          connection,
          projectId: session.projectId,
          pageId: draftPageId,
          draft,
          userId: request.user?.id
        });
        elementIdByLocator.set(`${draftPageId}:${draft.locatorType}:${draft.locatorValue}`, elementId);
      }

      const caseCode = body.caseCode ?? `REC_${session.sessionNo.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const caseName = body.caseName ?? `录制用例 ${session.sessionNo}`;
      await connection.query(
        `
        INSERT INTO tp_test_case (project_id, case_code, case_name, case_desc, priority, status, created_by)
        VALUES (?, ?, ?, '由录制会话自动生成', 'medium', 1, ?)
        ON DUPLICATE KEY UPDATE
          case_name = VALUES(case_name),
          case_desc = VALUES(case_desc),
          status = 1,
          updated_at = NOW(3)
        `,
        [session.projectId, caseCode, caseName, request.user?.id ?? null]
      );
      const [caseRows] = await connection.query(
        "SELECT id FROM tp_test_case WHERE project_id = ? AND case_code = ? LIMIT 1",
        [session.projectId, caseCode]
      );
      const caseId = (caseRows as Array<{ id: number }>)[0].id;
      await archiveCaseSteps({
        connection,
        caseId
      });

      const materializedSteps: MaterializedCaseStep[] = [
        createGotoMaterializedStep("打开录制页面", recordingUrlPattern(pageUrl))
      ];
      let currentUrlPattern = recordingUrlPattern(pageUrl);

      for (const draft of drafts) {
        const draftPageUrl = parseRecordingUrl(draft.url, session.startUrl);
        const draftUrlPattern = recordingUrlPattern(draftPageUrl);
        if (draftUrlPattern !== currentUrlPattern) {
          const draftPageTitle = snapshotPageTitle(draft.snapshot);
          if (
            !attachImplicitNavigationWait(materializedSteps[materializedSteps.length - 1], draftUrlPattern)
          ) {
            materializedSteps.push(
              createGotoMaterializedStep(
                draftPageTitle ? `打开页面 ${draftPageTitle}` : `打开页面 ${draftUrlPattern}`,
                draftUrlPattern
              )
            );
          }
          currentUrlPattern = draftUrlPattern;
        }
        const draftPageId = await getPageId(draft.url, draft.snapshot);
        const elementId = elementIdByLocator.get(`${draftPageId}:${draft.locatorType}:${draft.locatorValue}`);
        materializedSteps.push(createDraftMaterializedStep(draft, elementId ?? null));
      }

      for (const [index, step] of materializedSteps.entries()) {
        await connection.query(
          `
          INSERT INTO tp_case_step (
            case_id, step_order, step_name, action, element_id, step_dsl_json, locator_snapshot_json
          )
          VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))
          `,
          [
            caseId,
            index + 1,
            step.stepName,
            step.action,
            step.elementId,
            JSON.stringify(step.stepDsl),
            step.locatorSnapshot ? JSON.stringify(step.locatorSnapshot) : null
          ]
        );
      }

      await connection.query(
        "UPDATE tp_recording_session SET status = 'materialized', stopped_at = COALESCE(stopped_at, NOW(3)), updated_at = NOW(3) WHERE id = ?",
        [session.id]
      );
      await connection.commit();

      response.json({
        code: 200,
        message: "success",
        data: {
          sessionNo: session.sessionNo,
          pageId,
          caseId,
          elementCount: elementIdByLocator.size,
          stepCount: materializedSteps.length
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);
