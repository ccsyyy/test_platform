import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Video
} from "playwright";
import { createBlockingRedisClient, redis } from "../db/redis.js";
import { mysqlPool } from "../db/mysql.js";
import {
  getCaptchaAiConnectionConfig,
  getProjectAiConfig,
  getHealingAiConnectionConfig,
  recognizeCaptchaWithAi,
  type ProjectAiConfig
} from "../services/ai.js";
import { resolveAiLocatorCandidates } from "./aiLocatorResolver.js";
import { runAiVisualLocator } from "./aiVisualLocator.js";
import {
  buildLocator,
  LocatorFallbackError,
  type LocatorAttempt,
  type ResolvedLocatorMatch
} from "./locator.js";
import { runStep } from "./stepRunner.js";
import {
  createArtifact,
  createCaseResult,
  createLocatorHealLog,
  createStepResult,
  finishCaseResult,
  getCaseRows,
  getCaseSteps,
  getEnvironmentBaseUrl,
  getEnvironmentMeta,
  markJobFailedByNo,
  markJobFinished,
  markJobRunning,
  parsePayload,
  promoteMatchedLocator,
  recordLocatorAttempts,
  upsertHealedLocator
} from "./repository.js";
import type { CaseStepRecord, ExecutionQueuePayload } from "./types.js";

const QUEUE_KEY = "test-platform:queue:execution";
const FAILED_QUEUE_KEY = "test-platform:queue:execution:failed";
const workerId = `worker-${process.pid}`;
let shuttingDown = false;
const blockingRedis = createBlockingRedisClient();

type EnvironmentMeta = Awaited<ReturnType<typeof getEnvironmentMeta>>;

interface AiHealSnapshot {
  used: boolean;
  status: "verified" | "applied" | "failed" | "skipped";
  reason: string;
  confidence: number;
  selectedLocator: Record<string, unknown> | null;
  candidateCount: number;
}

interface AiCaptchaSnapshot {
  used: boolean;
  text: string;
  confidence: number;
  reason: string;
  imageLocator?: Record<string, unknown> | null;
  attempts?: Array<Record<string, unknown>>;
}

interface PendingHealLog {
  aiInput: Record<string, unknown>;
  aiCandidates: Array<Record<string, unknown>>;
  selectedLocator: Record<string, unknown> | null;
  confidence: number | null;
  reason: string | null;
  status: "verified" | "applied" | "failed" | "rejected_by_confidence" | "visual_failed";
  pageUrl?: string | null;
  pageTitle?: string | null;
}

interface StepExecutionEnvelope {
  runResult: Awaited<ReturnType<typeof runStep>>;
  locatorAttempts: LocatorAttempt[];
  aiHeal?: AiHealSnapshot | null;
  aiLog?: PendingHealLog | null;
  aiCaptcha?: AiCaptchaSnapshot | null;
}

class StepExecutionError extends Error {
  locatorAttempts: LocatorAttempt[];
  aiHeal?: AiHealSnapshot | null;
  aiLog?: PendingHealLog | null;
  aiCaptcha?: AiCaptchaSnapshot | null;

  constructor(
    message: string,
    options: {
      locatorAttempts?: LocatorAttempt[];
      aiHeal?: AiHealSnapshot | null;
      aiLog?: PendingHealLog | null;
      aiCaptcha?: AiCaptchaSnapshot | null;
    } = {}
  ) {
    super(message);
    this.name = "StepExecutionError";
    this.locatorAttempts = options.locatorAttempts ?? [];
    this.aiHeal = options.aiHeal ?? null;
    this.aiLog = options.aiLog ?? null;
    this.aiCaptcha = options.aiCaptcha ?? null;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

function artifactRoot(): string {
  return path.resolve(process.cwd(), "artifacts");
}

function jobArtifactDir(jobNo: string): string {
  return path.join(artifactRoot(), jobNo);
}

async function fileSize(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return undefined;
  }
}

function livePages(context: BrowserContext): Page[] {
  return context.pages().filter((page) => !page.isClosed());
}

function isBlankPageUrl(url: string): boolean {
  return !url || url === "about:blank" || url.startsWith("chrome-error://") || url.startsWith("data:");
}

function hasMeaningfulPageUrl(page: Page): boolean {
  try {
    return !isBlankPageUrl(page.url());
  } catch {
    return false;
  }
}

function resolveActivePage(context: BrowserContext, currentPage?: Page): Page | undefined {
  const pages = livePages(context);
  if (!pages.length) {
    return currentPage && !currentPage.isClosed() ? currentPage : undefined;
  }
  if (currentPage && !currentPage.isClosed() && hasMeaningfulPageUrl(currentPage)) {
    return currentPage;
  }
  const meaningfulPages = pages.filter(hasMeaningfulPageUrl);
  const latestMeaningfulPage = meaningfulPages[meaningfulPages.length - 1];
  if (latestMeaningfulPage && !latestMeaningfulPage.isClosed()) {
    return latestMeaningfulPage;
  }
  return currentPage && !currentPage.isClosed() ? currentPage : undefined;
}

async function waitForMeaningfulPaint(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        function countVisible(node: ParentNode): number {
          const elements = Array.from(node.querySelectorAll("*"));
          let count = 0;
          for (const element of elements) {
            const rect = (element as HTMLElement).getBoundingClientRect?.();
            const style = window.getComputedStyle(element as Element);
            if (rect && rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
              count += 1;
            }
            const shadowRoot = (element as HTMLElement).shadowRoot;
            if (shadowRoot) {
              count += countVisible(shadowRoot);
            }
          }
          return count;
        }
        const body = document.body;
        if (!body) return false;
        const text = body.innerText?.replace(/\s+/g, " ").trim() || "";
        const visibleCount = countVisible(document);
        const mediaCount = document.querySelectorAll("canvas,img,svg,video,iframe,wujie-app,micro-app").length;
        return text.length > 0 || visibleCount >= 6 || mediaCount > 0;
      },
      undefined,
      { timeout: 3000 }
    )
    .catch(() => undefined);
}

async function settlePageForArtifact(page?: Page): Promise<Page | undefined> {
  if (!page || page.isClosed()) {
    return undefined;
  }
  await page.bringToFront().catch(() => undefined);
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  await page.waitForLoadState("load", { timeout: 3000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
  await page
    .waitForFunction(
      () => document.readyState === "interactive" || document.readyState === "complete",
      undefined,
      { timeout: 1200 }
    )
    .catch(() => undefined);
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    )
    .catch(() => undefined);
  await waitForMeaningfulPaint(page);
  await page.waitForTimeout(1500).catch(() => undefined);
  return page.isClosed() ? undefined : page;
}

async function pageArtifactScore(page: Page): Promise<number> {
  if (page.isClosed()) {
    return -1;
  }
  const urlScore = hasMeaningfulPageUrl(page) ? 1000 : 0;
  const domScore = await page
    .evaluate(() => {
      function collect(node: ParentNode): { textLength: number; visibleCount: number; mediaCount: number } {
        let textLength = 0;
        let visibleCount = 0;
        let mediaCount = 0;
        const elements = Array.from(node.querySelectorAll("*"));
        for (const element of elements) {
          const target = element as HTMLElement;
          const rect = target.getBoundingClientRect?.();
          const style = window.getComputedStyle(element);
          if (rect && rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
            visibleCount += 1;
          }
          if (/^(CANVAS|IMG|SVG|VIDEO|IFRAME|WUJIE-APP|MICRO-APP)$/.test(element.tagName)) {
            mediaCount += 1;
          }
          const ownText = target.innerText || target.textContent || "";
          textLength += ownText.replace(/\s+/g, " ").trim().slice(0, 200).length;
          const shadowRoot = target.shadowRoot;
          if (shadowRoot) {
            const child = collect(shadowRoot);
            textLength += child.textLength;
            visibleCount += child.visibleCount;
            mediaCount += child.mediaCount;
          }
        }
        return { textLength, visibleCount, mediaCount };
      }
      const titleLength = document.title?.trim().length || 0;
      const bodyTextLength = document.body?.innerText?.replace(/\s+/g, " ").trim().length || 0;
      const collected = collect(document);
      return titleLength * 5 + bodyTextLength + collected.textLength + collected.visibleCount * 4 + collected.mediaCount * 80;
    })
    .catch(() => 0);
  return urlScore + domScore;
}

async function resolveArtifactPage(context: BrowserContext, currentPage?: Page): Promise<Page | undefined> {
  const pages = livePages(context);
  if (!pages.length) {
    return settlePageForArtifact(currentPage);
  }
  const settledPages: Page[] = [];
  for (const page of pages) {
    const settled = await settlePageForArtifact(page);
    if (settled) {
      settledPages.push(settled);
    }
  }
  const scoredPages = await Promise.all(
    settledPages.map(async (page, index) => ({
      page,
      index,
      score: await pageArtifactScore(page)
    }))
  );
  scoredPages.sort((a, b) => b.score - a.score || b.index - a.index);
  const selected = scoredPages[0]?.page ?? resolveActivePage(context, currentPage);
  if (selected && !selected.isClosed()) {
    await selected.bringToFront().catch(() => undefined);
  }
  return selected;
}

async function saveScreenshotArtifact(input: {
  page?: Page;
  payload: ExecutionQueuePayload;
  jobId: number;
  caseResultId: number;
  stepResultId?: number;
  testCaseId: number;
  suffix: string;
}): Promise<void> {
  const page = await settlePageForArtifact(input.page);
  if (!page) {
    return;
  }
  const screenshotPath = path.join(jobArtifactDir(input.payload.jobNo), `case-${input.testCaseId}-${input.suffix}.png`);
  const screenshot = await page
    .screenshot({
      path: screenshotPath,
      fullPage: true
    })
    .catch(() => undefined);
  if (!screenshot) {
    return;
  }
  await createArtifact({
    projectId: input.payload.projectId,
    jobId: input.jobId,
    caseResultId: input.caseResultId,
    stepResultId: input.stepResultId,
    artifactType: "screenshot",
    storagePath: screenshotPath,
    fileName: path.basename(screenshotPath),
    contentType: "image/png",
    fileSize: await fileSize(screenshotPath)
  });
}

function registerTrackedPage(
  trackedPages: Set<Page>,
  page: Page,
  updateCurrentPage: (page?: Page) => void,
  timeoutMs?: number
): void {
  if (trackedPages.has(page)) {
    if (hasMeaningfulPageUrl(page)) {
      updateCurrentPage(page);
    }
    return;
  }
  trackedPages.add(page);
  if (timeoutMs && timeoutMs > 0) {
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
  }
  if (hasMeaningfulPageUrl(page)) {
    updateCurrentPage(page);
  }
  page.on("close", () => {
    updateCurrentPage(undefined);
  });
  page.on("domcontentloaded", () => {
    if (hasMeaningfulPageUrl(page)) {
      updateCurrentPage(page);
    }
  });
  page.on("load", () => {
    if (hasMeaningfulPageUrl(page)) {
      updateCurrentPage(page);
    }
  });
  page.on("framenavigated", () => {
    if (hasMeaningfulPageUrl(page)) {
      updateCurrentPage(page);
    }
  });
  page.on("popup", (popup) => {
    registerTrackedPage(trackedPages, popup, updateCurrentPage, timeoutMs);
  });
}

async function launchBrowser(payload: ExecutionQueuePayload): Promise<Browser> {
  if (payload.browser === "chrome") {
    return chromium.launch({ channel: "chrome", headless: payload.config.headless });
  }
  if (payload.browser === "edge") {
    return chromium.launch({ channel: "msedge", headless: payload.config.headless });
  }
  return chromium.launch({ headless: payload.config.headless });
}

function getStepParams(step: CaseStepRecord): Record<string, unknown> {
  const params = step.stepDsl.params;
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

const IMPLICIT_NAVIGATION_ACTIONS = new Set(["click", "dblclick", "rightclick", "press", "check", "uncheck", "select"]);

function mergeStepParams(step: CaseStepRecord, params: Record<string, unknown>): CaseStepRecord {
  return {
    ...step,
    stepDsl: {
      ...step.stepDsl,
      params: {
        ...getStepParams(step),
        ...params
      }
    }
  };
}

function buildPrimaryOnlyStep(step: CaseStepRecord): CaseStepRecord {
  return {
    ...step,
    locatorSnapshot: null,
    locatorCandidates: []
  };
}

function hasLocatorSnapshot(step: CaseStepRecord): boolean {
  if (Array.isArray(step.locatorSnapshot)) {
    return step.locatorSnapshot.length > 0;
  }
  return Boolean(step.locatorSnapshot && Object.keys(step.locatorSnapshot).length);
}

function isMaterializedRecordingGoto(step: CaseStepRecord): boolean {
  if (step.action.toLowerCase() !== "goto") {
    return false;
  }
  const params = getStepParams(step);
  const url = typeof params.url === "string" ? params.url.trim() : "";
  if (!url || step.elementId !== null) {
    return false;
  }
  if (step.locatorType || step.locatorValue || step.locatorExpression || hasLocatorSnapshot(step)) {
    return false;
  }
  if (step.locatorCandidates.length > 0) {
    return false;
  }
  const stepName = String(step.stepName || "").trim();
  return !stepName || /^打开(?:录制)?页面(?:\s|$)/.test(stepName);
}

function retrofitRecordedNavigationSteps(steps: CaseStepRecord[]): CaseStepRecord[] {
  const normalized: CaseStepRecord[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const previous = normalized[normalized.length - 1];
    const next = steps[index + 1];
    if (
      previous &&
      next &&
      next.action.toLowerCase() !== "goto" &&
      IMPLICIT_NAVIGATION_ACTIONS.has(previous.action.toLowerCase()) &&
      isMaterializedRecordingGoto(step)
    ) {
      const gotoUrl = String(getStepParams(step).url || "").trim();
      const existingWait =
        typeof getStepParams(previous).waitForUrlPattern === "string"
          ? String(getStepParams(previous).waitForUrlPattern || "").trim()
          : "";
      if (!existingWait || existingWait === gotoUrl) {
        normalized[normalized.length - 1] = existingWait
          ? previous
          : mergeStepParams(previous, { waitForUrlPattern: gotoUrl });
        normalized.push(mergeStepParams(step, { skipIfAlreadyOnUrlPattern: true }));
        continue;
      }
    }
    normalized.push(step);
  }
  return normalized;
}

function environmentAllowsAi(projectConfig: ProjectAiConfig, environmentMeta: EnvironmentMeta): boolean {
  if (!environmentMeta?.envType) {
    return true;
  }
  return environmentMeta.envType !== "prod" || projectConfig.allowAiOnProd;
}

function hasUsableAiModel(projectConfig: ProjectAiConfig): boolean {
  const connection = getHealingAiConnectionConfig(projectConfig);
  return Boolean(connection.baseUrl && connection.model && connection.hasApiKey);
}

function aiHealingSkipReason(
  step: CaseStepRecord,
  projectConfig: ProjectAiConfig,
  environmentMeta: EnvironmentMeta
): string | null {
  const params = getStepParams(step);
  if (step.action.toLowerCase() === "goto") {
    return "AI 自愈不处理 goto 步骤";
  }
  if (params.allowAiHealing === false) {
    return "当前步骤已关闭 AI 自愈";
  }
  if (!environmentAllowsAi(projectConfig, environmentMeta)) {
    return "当前环境不允许使用 AI 自愈";
  }
  if (!projectConfig.enableAiHealing) {
    return "项目未开启 AI 自愈定位";
  }
  if (!hasUsableAiModel(projectConfig)) {
    return "AI 模型未配置完整";
  }
  return null;
}

function canUseAiHealing(step: CaseStepRecord, projectConfig: ProjectAiConfig, environmentMeta: EnvironmentMeta): boolean {
  return aiHealingSkipReason(step, projectConfig, environmentMeta) === null;
}

function canUseAiVisualLocator(step: CaseStepRecord, projectConfig: ProjectAiConfig, environmentMeta: EnvironmentMeta): boolean {
  const params = getStepParams(step);
  return (
    projectConfig.enableAiVisualLocator &&
    step.action.toLowerCase() !== "goto" &&
    params.allowAiVisualLocator !== false &&
    environmentAllowsAi(projectConfig, environmentMeta)
  );
}

function hasCaptchaKeyword(value: unknown): boolean {
  return /验证码|校验码|图形码|captcha|verify\s*code|verification\s*code/i.test(String(value || ""));
}

function isCaptchaStep(step: CaseStepRecord): boolean {
  const params = getStepParams(step);
  if (params.aiCaptcha === true) {
    return true;
  }
  const attrs =
    step.elementAttributes && typeof step.elementAttributes === "object" && !Array.isArray(step.elementAttributes)
      ? step.elementAttributes
      : {};
  return [
    step.stepName,
    step.elementName,
    attrs.placeholder,
    attrs.name,
    attrs.id,
    attrs.className,
    attrs.label,
    attrs.role,
    attrs.ariaLabel
  ].some(hasCaptchaKeyword);
}

function canUseAiCaptcha(step: CaseStepRecord, projectConfig: ProjectAiConfig, environmentMeta: EnvironmentMeta): boolean {
  return (
    step.action.toLowerCase() === "fill" &&
    isCaptchaStep(step) &&
    projectConfig.enableAiCaptcha &&
    environmentAllowsAi(projectConfig, environmentMeta)
  );
}

type LocatorSnapshotInput =
  | ResolvedLocatorMatch
  | {
      id?: unknown;
      locatorType?: unknown;
      locatorValue?: unknown;
      locatorExpression?: unknown;
      source?: unknown;
      confidence?: unknown;
      score?: unknown;
    };

function locatorSnapshot(locator: LocatorSnapshotInput | null | undefined): Record<string, unknown> | null {
  if (!locator) {
    return null;
  }
  return {
    id: locator.id ?? undefined,
    locatorType: locator.locatorType ?? "",
    locatorValue: locator.locatorValue ?? "",
    locatorExpression: locator.locatorExpression ?? null,
    source: locator.source ?? "",
    confidence: locator.confidence ?? undefined,
    score: locator.score ?? undefined
  };
}

function compactAttempts(attempts: LocatorAttempt[]): Array<Record<string, unknown>> {
  return attempts.map((attempt) => ({
    id: attempt.id,
    locatorType: attempt.locatorType,
    locatorValue: attempt.locatorValue,
    locatorExpression: attempt.locatorExpression,
    source: attempt.source,
    candidateIndex: attempt.candidateIndex,
    candidateTotal: attempt.candidateTotal,
    success: attempt.success,
    errorMessage: attempt.errorMessage ?? "",
    confidence: attempt.confidence,
    score: attempt.score
  }));
}

function compactAiCandidates(candidates: Array<unknown>): Array<Record<string, unknown>> {
  return candidates.map((candidate) => {
    const record =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : {};
    return {
      locatorType: record.locatorType ?? "",
      locatorValue: record.locatorValue ?? "",
      locatorExpression: record.locatorExpression ?? null,
      confidence: Number(record.confidence || 0),
      reason: record.reason ?? ""
    };
  });
}

function sanitizeSnapshotValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeSnapshotValue(item));
  }
  if (typeof value === "object") {
    return sanitizeStepParams(value as Record<string, unknown>);
  }
  return String(value);
}

function sanitizeStepParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.entries(params).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (/password|passwd|pwd|token|secret|apikey|api_key|authorization|cookie/i.test(key)) {
      acc[key] = "***";
      return acc;
    }
    acc[key] = sanitizeSnapshotValue(value);
    return acc;
  }, {});
}

interface CaptchaLocatorRef extends Record<string, unknown> {
  locatorType: string;
  locatorValue: string;
}

const DYNAMIC_CAPTCHA_QUERY_KEYS = new Set(["uuid", "token", "ts", "timestamp", "t", "r", "rand", "random", "nonce", "_"]);

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

function buildGenericCaptchaCssLocator(locatorValue: string): string | null {
  const normalizedValue = decodeLocatorText(locatorValue);
  const match = normalizedValue.match(/^([a-z0-9_-]+)\[src=(['"])(.+?)\2\]$/i);
  if (!match || !hasCaptchaKeyword(match[3] || "")) {
    return null;
  }
  return `${match[1] || "img"}[src*="captcha"]`;
}

function dedupeCaptchaLocators(locators: CaptchaLocatorRef[]): CaptchaLocatorRef[] {
  const seen = new Set<string>();
  const deduped: CaptchaLocatorRef[] = [];
  for (const locator of locators) {
    const locatorType = locator.locatorType.trim();
    const locatorValue = locator.locatorValue.trim();
    if (!locatorType || !locatorValue) {
      continue;
    }
    const key = `${canonicalLocatorType(locatorType)}::${locatorValue}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({ locatorType, locatorValue });
  }
  return deduped;
}

function deriveCaptchaImageLocators(locator: CaptchaLocatorRef): CaptchaLocatorRef[] {
  if (canonicalLocatorType(locator.locatorType) !== "css") {
    return [locator];
  }
  const derived: CaptchaLocatorRef[] = [locator];
  const stableLocatorValue = buildStableCaptchaCssLocator(locator.locatorValue);
  if (stableLocatorValue) {
    derived.push({ locatorType: "css", locatorValue: stableLocatorValue });
  }
  const genericLocatorValue = buildGenericCaptchaCssLocator(locator.locatorValue);
  if (genericLocatorValue) {
    derived.push({ locatorType: "css", locatorValue: genericLocatorValue });
  }
  return dedupeCaptchaLocators(derived);
}

function selectCaptchaImageLocator(params: Record<string, unknown>): CaptchaLocatorRef | null {
  const structured = params.captchaImageLocator;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    const record = structured as Record<string, unknown>;
    const locatorType = String(record.locatorType ?? record.type ?? "").trim();
    const locatorValue = String(record.locatorValue ?? record.value ?? "").trim();
    if (locatorType && locatorValue) {
      return { locatorType, locatorValue };
    }
  }
  const locatorValue =
    typeof params.captchaImageLocatorValue === "string"
      ? params.captchaImageLocatorValue.trim()
      : typeof params.captchaImageLocator === "string"
        ? params.captchaImageLocator.trim()
        : "";
  if (!locatorValue) {
    return null;
  }
  return {
    locatorType: typeof params.captchaImageLocatorType === "string" ? params.captchaImageLocatorType : "css",
    locatorValue
  };
}

function selectCaptchaImageLocators(params: Record<string, unknown>): CaptchaLocatorRef[] {
  const primary = selectCaptchaImageLocator(params);
  return primary ? deriveCaptchaImageLocators(primary) : [];
}

function isLikelyCaptchaRefreshLocator(locator: CaptchaLocatorRef): boolean {
  const locatorType = canonicalLocatorType(locator.locatorType);
  if (["css", "xpath", "relativexpath", "compactcss", "testid"].includes(locatorType)) {
    return true;
  }
  return hasCaptchaKeyword(locator.locatorValue);
}

function selectCaptchaRefreshLocator(params: Record<string, unknown>): CaptchaLocatorRef | null {
  const structured = params.captchaRefreshLocator;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    const record = structured as Record<string, unknown>;
    const locatorType = String(record.locatorType ?? record.type ?? "").trim();
    const locatorValue = String(record.locatorValue ?? record.value ?? "").trim();
    if (locatorType && locatorValue) {
      const locator = { locatorType, locatorValue };
      return isLikelyCaptchaRefreshLocator(locator) ? locator : null;
    }
  }
  const locatorValue =
    typeof params.captchaRefreshLocatorValue === "string"
      ? params.captchaRefreshLocatorValue.trim()
      : typeof params.captchaRefreshLocator === "string"
        ? params.captchaRefreshLocator.trim()
        : "";
  if (!locatorValue) {
    return null;
  }
  const locator = {
    locatorType: typeof params.captchaRefreshLocatorType === "string" ? params.captchaRefreshLocatorType : "css",
    locatorValue
  };
  return isLikelyCaptchaRefreshLocator(locator) ? locator : null;
}

function isCaptchaImageInputIssue(reason: unknown): boolean {
  const text = String(reason || "").toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes("no image was provided") ||
    text.includes("no captcha image was provided") ||
    text.includes("no image has been provided") ||
    text.includes("please provide the actual captcha image") ||
    text.includes("vision") ||
    text.includes("multimodal") ||
    text.includes("image input") ||
    text.includes("image is required")
  );
}

async function refreshCaptchaImage(
  page: Page,
  params: Record<string, unknown>,
  imageLocator: CaptchaLocatorRef
): Promise<void> {
  const imageClicked = await buildLocator(page, imageLocator.locatorType, imageLocator.locatorValue)
    .first()
    .click({ timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (!imageClicked) {
    const refreshLocator = selectCaptchaRefreshLocator(params);
    if (refreshLocator) {
      await buildLocator(page, refreshLocator.locatorType, refreshLocator.locatorValue)
        .first()
        .click({ timeout: 1500 })
        .catch(() => undefined);
    }
  }
  await page.waitForTimeout(500).catch(() => undefined);
}

async function captureCaptchaImage(
  page: Page,
  imageLocators: CaptchaLocatorRef[]
): Promise<{ imageBuffer: Buffer; imageLocator: CaptchaLocatorRef }> {
  const locatorErrors: Array<Record<string, unknown>> = [];
  for (const imageLocator of imageLocators) {
    try {
      const image = buildLocator(page, imageLocator.locatorType, imageLocator.locatorValue).first();
      await image.waitFor({ state: "visible", timeout: 2500 });
      const imageBuffer = await image.screenshot({ animations: "disabled", timeout: 2500 });
      return { imageBuffer, imageLocator };
    } catch (error) {
      locatorErrors.push({
        locatorType: imageLocator.locatorType,
        locatorValue: imageLocator.locatorValue,
        status: "locator_failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  throw new StepExecutionError("Failed to locate captcha image", {
    aiCaptcha: {
      used: true,
      text: "",
      confidence: 0,
      reason: "Captcha image locator did not resolve on the page.",
      imageLocator: imageLocators[0] ?? null,
      attempts: locatorErrors
    }
  });
}

async function applyAiCaptchaIfNeeded(input: {
  page: Page;
  step: CaseStepRecord;
  projectConfig: ProjectAiConfig;
  environmentMeta: EnvironmentMeta;
}): Promise<{ step: CaseStepRecord; aiCaptcha: AiCaptchaSnapshot | null }> {
  if (!canUseAiCaptcha(input.step, input.projectConfig, input.environmentMeta)) {
    return { step: input.step, aiCaptcha: null };
  }

  const params = getStepParams(input.step);
  const imageLocators = selectCaptchaImageLocators(params);
  if (!imageLocators.length) {
    throw new StepExecutionError("AI captcha is enabled, but captcha image locator is missing", {
      aiCaptcha: {
        used: true,
        text: "",
        confidence: 0,
        reason: "Missing captcha image locator"
      }
    });
  }

  const pageTitle = await input.page.title().catch(() => "");
  const threshold = Number(input.projectConfig.captchaConfidenceThreshold || 80);
  const maxAttempts = Math.max(1, Number(input.projectConfig.captchaMaxAttempts || 3));
  const attempts: Array<Record<string, unknown>> = [];
  const captchaConnection = getCaptchaAiConnectionConfig(input.projectConfig);
  let activeImageLocator = imageLocators[0]!;

  for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
    const capture = await captureCaptchaImage(input.page, deriveCaptchaImageLocators(activeImageLocator));
    const imageBuffer = capture.imageBuffer;
    activeImageLocator = capture.imageLocator;
    let recognition;
    try {
      recognition = await recognizeCaptchaWithAi({
        projectConfig: input.projectConfig,
        imageDataUrl: `data:image/png;base64,${imageBuffer.toString("base64")}`,
        hint: typeof params.aiCaptchaHint === "string" ? params.aiCaptchaHint : undefined,
        pageUrl: input.page.url(),
        pageTitle
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      attempts.push({
        attemptNo,
        text: "",
        confidence: 0,
        reason,
        status: "error"
      });
      throw new StepExecutionError(`AI 验证码识别失败：${reason}`, {
        aiCaptcha: {
          used: true,
          text: "",
          confidence: 0,
          reason,
          imageLocator: activeImageLocator,
          attempts
        }
      });
    }
    const confidence = Number(recognition.confidence || 0);
    const passed = Boolean(recognition.text) && confidence >= threshold;
    attempts.push({
      attemptNo,
      text: recognition.text || "",
      confidence,
      reason: recognition.reason || "",
      status: passed ? "success" : "failed"
    });
    if (!passed && isCaptchaImageInputIssue(recognition.reason)) {
      throw new StepExecutionError(
        `Configured AI model "${captchaConnection.model}" did not consume the captcha image input`,
        {
          aiCaptcha: {
            used: true,
            text: recognition.text || "",
            confidence,
            reason:
              recognition.reason ||
              `Configured AI model "${captchaConnection.model}" does not support captcha image recognition.`,
            imageLocator: activeImageLocator,
            attempts
          }
        }
      );
    }
    if (passed) {
      return {
        step: mergeStepParams(input.step, { value: recognition.text }),
        aiCaptcha: {
          used: true,
          text: recognition.text,
          confidence,
          reason: recognition.reason || "",
          imageLocator: activeImageLocator,
          attempts
        }
      };
    }
    if (attemptNo < maxAttempts) {
      await refreshCaptchaImage(input.page, params, activeImageLocator);
    }
  }

  const lastAttempt = attempts[attempts.length - 1] || {};
  throw new StepExecutionError("AI captcha recognition did not reach the confidence threshold", {
    aiCaptcha: {
      used: true,
      text: String(lastAttempt.text || ""),
      confidence: Number(lastAttempt.confidence || 0),
      reason: `Confidence is below threshold ${threshold}. Manual intervention is required.`,
      imageLocator: activeImageLocator,
      attempts
    }
  });
}

function makeAiOnlyStep(step: CaseStepRecord, candidates: CaseStepRecord["locatorCandidates"]): CaseStepRecord {
  return {
    ...step,
    locatorType: null,
    locatorValue: null,
    locatorExpression: null,
    locatorSnapshot: null,
    locatorCandidates: candidates.map((candidate, index) => ({
      ...candidate,
      isPrimary: index === 0,
      source: "ai_candidate"
    }))
  };
}

function buildRepairSuggestion(step: CaseStepRecord, attempts: LocatorAttempt[], reason: string): string {
  const failed = attempts.filter((attempt) => !attempt.success);
  const hasStrictConflict = failed.some((attempt) => /strict match conflict|strict mode violation/i.test(attempt.errorMessage || ""));
  const hasInvisible = failed.some((attempt) => /not visible|element not visible/i.test(attempt.errorMessage || ""));
  const hints = [
    `Step "${step.stepName || step.action}" failed after primary, fallback and AI locator attempts.`,
    reason
  ];
  if (hasStrictConflict) {
    hints.push("Multiple matching elements were found. Narrow the locator to a stable region or add data-testid.");
  }
  if (hasInvisible) {
    hints.push("The target element exists but is not visible. Check hover menus, dialogs, tabs or page state before this step.");
  }
  if (step.elementName) {
    hints.push(`Review the element "${step.elementName}" in the element library and update its primary locator if needed.`);
  }
  return hints.filter(Boolean).join(" ");
}

async function tryAiVisualFallback(input: {
  page: Page;
  step: CaseStepRecord;
  projectConfig: ProjectAiConfig;
  environmentMeta: EnvironmentMeta;
  baseUrl?: string;
  attempts: LocatorAttempt[];
  aiInput: Record<string, unknown>;
  aiCandidates: Array<Record<string, unknown>>;
  reason: string;
  aiCaptcha: AiCaptchaSnapshot | null;
}): Promise<StepExecutionEnvelope> {
  if (!canUseAiVisualLocator(input.step, input.projectConfig, input.environmentMeta)) {
    const status: PendingHealLog["status"] = input.reason.includes("confidence threshold") ? "rejected_by_confidence" : "failed";
    const finalReason = buildRepairSuggestion(input.step, input.attempts, input.reason);
    throw new StepExecutionError(input.reason, {
      locatorAttempts: input.attempts,
      aiCaptcha: input.aiCaptcha,
      aiHeal: {
        used: true,
        status: "failed",
        reason: finalReason,
        confidence: 0,
        selectedLocator: null,
        candidateCount: input.aiCandidates.length
      },
      aiLog: {
        aiInput: input.aiInput,
        aiCandidates: input.aiCandidates,
        selectedLocator: null,
        confidence: 0,
        reason: finalReason,
        status,
        pageUrl: input.page.url(),
        pageTitle: await input.page.title().catch(() => "")
      }
    });
  }

  try {
    const visualResult = await runAiVisualLocator({
      page: input.page,
      step: input.step,
      projectConfig: input.projectConfig
    });
    const selectedLocator = locatorSnapshot(visualResult.matchedLocator);
    const reason = `Midscene.js visual locator executed by ${visualResult.provider}.`;
    return {
      runResult: {
        matchedLocator: visualResult.matchedLocator,
        locatorAttempts: input.attempts,
        page: visualResult.page
      },
      locatorAttempts: input.attempts,
      aiCaptcha: input.aiCaptcha,
      aiHeal: {
        used: true,
        status: "verified",
        reason,
        confidence: 100,
        selectedLocator,
        candidateCount: input.aiCandidates.length
      },
      aiLog: {
        aiInput: {
          ...input.aiInput,
          visualPrompt: visualResult.prompt
        },
        aiCandidates: input.aiCandidates,
        selectedLocator,
        confidence: 100,
        reason,
        status: "verified",
        pageUrl: visualResult.page.url(),
        pageTitle: await visualResult.page.title().catch(() => "")
      }
    };
  } catch (visualError) {
    const reason = visualError instanceof Error ? visualError.message : String(visualError);
    const repairSuggestion = buildRepairSuggestion(input.step, input.attempts, reason);
    throw new StepExecutionError(repairSuggestion, {
      locatorAttempts: input.attempts,
      aiCaptcha: input.aiCaptcha,
      aiHeal: {
        used: true,
        status: "failed",
        reason: repairSuggestion,
        confidence: 0,
        selectedLocator: null,
        candidateCount: input.aiCandidates.length
      },
      aiLog: {
        aiInput: input.aiInput,
        aiCandidates: input.aiCandidates,
        selectedLocator: null,
        confidence: 0,
        reason: repairSuggestion,
        status: "visual_failed",
        pageUrl: input.page.url(),
        pageTitle: await input.page.title().catch(() => "")
      }
    });
  }
}

async function executeStepWithAiSupport(input: {
  page: Page;
  step: CaseStepRecord;
  baseUrl?: string;
  projectConfig: ProjectAiConfig;
  environmentMeta: EnvironmentMeta;
}): Promise<StepExecutionEnvelope> {
  const captchaResult = await applyAiCaptchaIfNeeded({
    page: input.page,
    step: input.step,
    projectConfig: input.projectConfig,
    environmentMeta: input.environmentMeta
  });
  const executableStep = captchaResult.step;

  try {
    const runResult = await runStep(input.page, executableStep, input.baseUrl);
    return {
      runResult,
      locatorAttempts: runResult.locatorAttempts ?? [],
      aiCaptcha: captchaResult.aiCaptcha
    };
  } catch (error) {
    if (error instanceof StepExecutionError) {
      throw error;
    }
    const initialAttempts = error instanceof LocatorFallbackError ? error.attempts : [];
    const skipReason =
      error instanceof LocatorFallbackError
        ? aiHealingSkipReason(executableStep, input.projectConfig, input.environmentMeta)
        : "非 locator 候选失败，未进入 AI 自愈";
    if (!(error instanceof LocatorFallbackError) || !canUseAiHealing(executableStep, input.projectConfig, input.environmentMeta)) {
      throw new StepExecutionError(error instanceof Error ? error.message : String(error), {
        locatorAttempts: initialAttempts,
        aiCaptcha: captchaResult.aiCaptcha,
        aiHeal:
          error instanceof LocatorFallbackError && skipReason
            ? {
                used: false,
                status: "skipped",
                reason: skipReason,
                confidence: 0,
                selectedLocator: null,
                candidateCount: 0
              }
            : null
      });
    }

    let aiResolution: Awaited<ReturnType<typeof resolveAiLocatorCandidates>>;
    try {
      aiResolution = await resolveAiLocatorCandidates({
        projectConfig: input.projectConfig,
        page: input.page,
        step: executableStep,
        attempts: initialAttempts
      });
    } catch (aiError) {
      const reason = aiError instanceof Error ? aiError.message : String(aiError);
      const pageTitle = await input.page.title().catch(() => "");
      throw new StepExecutionError(error.message, {
        locatorAttempts: initialAttempts,
        aiCaptcha: captchaResult.aiCaptcha,
        aiHeal: {
          used: true,
          status: "failed",
          reason,
          confidence: 0,
          selectedLocator: null,
          candidateCount: 0
        },
        aiLog: {
          aiInput: {
            action: executableStep.action,
            stepName: executableStep.stepName ?? "",
            error: reason
          },
          aiCandidates: [],
          selectedLocator: null,
          confidence: 0,
          reason,
          status: "failed",
          pageUrl: input.page.url(),
          pageTitle
        }
      });
    }

    if (!aiResolution.candidates.length) {
      const rejectedByConfidence = aiResolution.suggestions.length > 0 && aiResolution.rejectedSuggestions.length === aiResolution.suggestions.length;
      const reason = rejectedByConfidence
        ? `AI locator candidates are below confidence threshold ${input.projectConfig.aiLocatorConfidenceThreshold}`
        : "AI did not return any usable locator";
      return tryAiVisualFallback({
        page: input.page,
        step: executableStep,
        projectConfig: input.projectConfig,
        environmentMeta: input.environmentMeta,
        baseUrl: input.baseUrl,
        attempts: initialAttempts,
        aiInput: aiResolution.aiInput,
        aiCandidates: compactAiCandidates(aiResolution.suggestions),
        reason,
        aiCaptcha: captchaResult.aiCaptcha
      });
    }

    const aiStep = makeAiOnlyStep(executableStep, aiResolution.candidates);
    try {
      const aiRunResult = await runStep(input.page, aiStep, input.baseUrl);
      const attempts = [...initialAttempts, ...(aiRunResult.locatorAttempts ?? [])];
      const selectedLocator = locatorSnapshot(aiRunResult.matchedLocator ?? aiResolution.candidates[0] ?? null);
      const selectedSuggestion = aiResolution.suggestions.find(
        (suggestion) =>
          suggestion.locatorType === selectedLocator?.locatorType &&
          suggestion.locatorValue === selectedLocator?.locatorValue
      );
      const confidence = Number(selectedSuggestion?.confidence ?? selectedLocator?.confidence ?? 0);
      const reason = selectedSuggestion?.reason || "AI locator verified during execution";
      const shouldAutoApply =
        Boolean(executableStep.elementId) &&
        input.projectConfig.autoPromoteHealedLocator &&
        !input.projectConfig.requireManualReview;
      const healStatus: PendingHealLog["status"] = shouldAutoApply ? "applied" : "verified";
      const aiHeal: AiHealSnapshot = {
        used: true,
        status: healStatus,
        reason,
        confidence,
        selectedLocator,
        candidateCount: aiResolution.candidates.length
      };
      return {
        runResult: {
          ...aiRunResult,
          locatorAttempts: attempts
        },
        locatorAttempts: attempts,
        aiCaptcha: captchaResult.aiCaptcha,
        aiHeal,
        aiLog: {
          aiInput: aiResolution.aiInput,
          aiCandidates: compactAiCandidates(aiResolution.suggestions),
          selectedLocator,
          confidence,
          reason,
          status: healStatus,
          pageUrl: String(aiResolution.aiInput.pageUrl || input.page.url()),
          pageTitle: String(aiResolution.aiInput.pageTitle || "")
        }
      };
    } catch (aiError) {
      const aiAttempts = aiError instanceof LocatorFallbackError ? aiError.attempts : [];
      const attempts = [...initialAttempts, ...aiAttempts];
      const reason = aiError instanceof Error ? aiError.message : String(aiError);
      const selectedLocator = locatorSnapshot(aiResolution.candidates[0] ?? null);
      return tryAiVisualFallback({
        page: input.page,
        step: executableStep,
        projectConfig: input.projectConfig,
        environmentMeta: input.environmentMeta,
        baseUrl: input.baseUrl,
        attempts,
        aiInput: {
          ...aiResolution.aiInput,
          failedSelectedLocator: selectedLocator
        },
        aiCandidates: compactAiCandidates(aiResolution.suggestions),
        reason,
        aiCaptcha: captchaResult.aiCaptcha
      });
    }
  }
}

async function runPayload(payload: ExecutionQueuePayload): Promise<void> {
  if (!payload.jobNo || payload.projectId <= 0 || payload.caseIds.length === 0) {
    throw new Error("执行队列消息不完整");
  }

  const lockKey = `test-platform:lock:execution:${payload.jobNo}`;
  const lockValue = `${workerId}-${Date.now()}`;
  const locked = await redis.set(lockKey, lockValue, "EX", 60 * 30, "NX");
  if (locked !== "OK") {
    console.log(`Skip locked job: ${payload.jobNo}`);
    return;
  }

  let browser: Browser | undefined;
  let jobId: number | undefined;
  const counts = { passed: 0, failed: 0, skipped: 0 };
  let jobError: string | undefined;

  try {
    await ensureDir(jobArtifactDir(payload.jobNo));
    jobId = await markJobRunning(payload.jobNo);
    await redis.hmset(`test-platform:execution:${payload.jobNo}:status`, {
      status: "running",
      workerId,
      startedAt: new Date().toISOString()
    });
    await redis.expire(`test-platform:execution:${payload.jobNo}:status`, 60 * 60 * 24);

    const baseUrl = await getEnvironmentBaseUrl(payload.environmentId);
    const environmentMeta = await getEnvironmentMeta(payload.environmentId);
    const projectAiConfig = await getProjectAiConfig(payload.projectId);
    const defaultTimeoutMs = Number(payload.config.timeoutMs || 30000);
    const cases = await getCaseRows(payload.caseIds);
    browser = await launchBrowser(payload);

    for (const testCase of cases) {
      const caseStart = Date.now();
      const caseResultId = await createCaseResult(jobId, testCase.id, testCase.caseName);
      const contextOptions: BrowserContextOptions = {
        ignoreHTTPSErrors: true
      };
      if (payload.config.viewport) {
        contextOptions.viewport = payload.config.viewport;
      }
      if (payload.config.video) {
        contextOptions.recordVideo = {
          dir: path.join(jobArtifactDir(payload.jobNo), "videos")
        };
      }
      const context = await browser.newContext(contextOptions);
      let currentPage = await context.newPage();
      currentPage.setDefaultTimeout(defaultTimeoutMs);
      currentPage.setDefaultNavigationTimeout(defaultTimeoutMs);
      const trackedPages = new Set<Page>();
      const setCurrentPage = (page?: Page): void => {
        const activePage = page && !page.isClosed() ? page : resolveActivePage(context, currentPage);
        if (activePage) {
          currentPage = activePage;
        }
      };
      registerTrackedPage(trackedPages, currentPage, setCurrentPage, defaultTimeoutMs);
      context.on("page", (page) => {
        registerTrackedPage(trackedPages, page, setCurrentPage, defaultTimeoutMs);
      });
      let caseStatus: "passed" | "failed" = "passed";
      let caseError: string | undefined;

      if (payload.config.trace) {
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true
        });
      }

      try {
        const steps = retrofitRecordedNavigationSteps(await getCaseSteps(testCase.id));
        for (const rawStep of steps) {
          const step = projectAiConfig.enableLocatorFallback ? rawStep : buildPrimaryOnlyStep(rawStep);
          const stepStart = Date.now();
          let stepStatus: "passed" | "failed" = "passed";
          let stepError: string | undefined;
          let stepRunResult: Awaited<ReturnType<typeof runStep>> = {};
          let locatorAttempts: LocatorAttempt[] = [];
          let aiHeal: AiHealSnapshot | null = null;
          let aiCaptcha: AiCaptchaSnapshot | null = null;
          let pendingAiLog: PendingHealLog | null = null;

          for (let attempt = 0; attempt <= payload.config.retries; attempt += 1) {
            try {
              const activePage = resolveActivePage(context, currentPage);
              if (!activePage) {
                throw new Error("No active page available for step execution");
              }
              const envelope = await executeStepWithAiSupport({
                page: activePage,
                step,
                baseUrl,
                projectConfig: projectAiConfig,
                environmentMeta
              });
              stepRunResult = envelope.runResult;
              locatorAttempts = envelope.locatorAttempts;
              aiHeal = envelope.aiHeal ?? null;
              aiCaptcha = envelope.aiCaptcha ?? null;
              pendingAiLog = envelope.aiLog ?? null;
              if (stepRunResult.page && !stepRunResult.page.isClosed()) {
                currentPage = stepRunResult.page;
              } else {
                const latestPage = resolveActivePage(context, currentPage);
                if (latestPage) {
                  currentPage = latestPage;
                }
              }
              stepStatus = "passed";
              stepError = undefined;
              break;
            } catch (error) {
              const executionError =
                error instanceof StepExecutionError
                  ? error
                  : new StepExecutionError(error instanceof Error ? error.message : String(error));
              stepStatus = "failed";
              stepError = executionError.message;
              locatorAttempts = executionError.locatorAttempts;
              aiHeal = executionError.aiHeal ?? null;
              aiCaptcha = executionError.aiCaptcha ?? null;
              pendingAiLog = executionError.aiLog ?? null;
              if (attempt >= payload.config.retries) {
                break;
              }
            }
          }

          if (
            stepStatus === "passed" &&
            aiHeal?.status === "applied" &&
            pendingAiLog?.selectedLocator &&
            step.elementId
          ) {
            await upsertHealedLocator({
              elementId: step.elementId,
              locatorType: String(pendingAiLog.selectedLocator.locatorType || ""),
              locatorValue: String(pendingAiLog.selectedLocator.locatorValue || ""),
              locatorExpression:
                typeof pendingAiLog.selectedLocator.locatorExpression === "string"
                  ? pendingAiLog.selectedLocator.locatorExpression
                  : null,
              confidence: pendingAiLog.confidence,
              source: "healed"
            }).catch((error) => {
              pendingAiLog = {
                ...pendingAiLog!,
                status: "verified",
                reason: `Auto apply failed: ${error instanceof Error ? error.message : String(error)}`
              };
              aiHeal = {
                ...aiHeal!,
                status: "verified",
                reason: pendingAiLog!.reason || aiHeal!.reason
              };
            });
          }

          const stepResultId = await createStepResult({
            caseResultId,
            stepId: step.id,
            stepOrder: step.stepOrder,
            action: step.action,
            status: stepStatus,
            durationMs: Date.now() - stepStart,
            errorMessage: stepError,
            snapshot: {
              stepName: step.stepName,
              action: step.action,
              elementId: step.elementId,
              elementName: step.elementName,
              params: sanitizeStepParams(getStepParams(step)),
              locatorAttempts: compactAttempts(locatorAttempts),
              aiHeal,
              aiCaptcha,
              resolvedLocator: stepRunResult.matchedLocator
                ? {
                    locatorType: stepRunResult.matchedLocator.locatorType,
                    locatorValue: stepRunResult.matchedLocator.locatorValue,
                    locatorExpression: stepRunResult.matchedLocator.locatorExpression,
                    resolution: stepRunResult.matchedLocator.resolution,
                    candidateIndex: stepRunResult.matchedLocator.candidateIndex,
                    candidateTotal: stepRunResult.matchedLocator.candidateTotal,
                    source: stepRunResult.matchedLocator.source,
                    confidence: stepRunResult.matchedLocator.confidence ?? null
                  }
                : null
            }
          });

          await recordLocatorAttempts(locatorAttempts).catch((error) =>
            console.error(`Record locator attempts failed: ${payload.jobNo}`, error)
          );

          if (stepStatus === "passed" && stepRunResult.matchedLocator && step.elementId) {
            await promoteMatchedLocator({
              elementId: step.elementId,
              locator: stepRunResult.matchedLocator
            }).catch((error) => console.error(`Promote matched locator failed: ${payload.jobNo}`, error));
          }

          if (pendingAiLog) {
            await createLocatorHealLog({
              projectId: payload.projectId,
              elementId: step.elementId,
              caseId: testCase.id,
              stepId: step.id,
              jobId,
              stepResultId,
              pageUrl: pendingAiLog.pageUrl,
              pageTitle: pendingAiLog.pageTitle,
              action: step.action,
              oldLocator: locatorSnapshot({
                locatorType: step.locatorType ?? "",
                locatorValue: step.locatorValue ?? "",
                locatorExpression: step.locatorExpression ?? null,
                source: "step_primary"
              }),
              attemptedLocators: compactAttempts(locatorAttempts),
              aiInput: pendingAiLog.aiInput,
              aiCandidates: pendingAiLog.aiCandidates,
              selectedLocator: pendingAiLog.selectedLocator,
              confidence: pendingAiLog.confidence,
              reason: pendingAiLog.reason,
              status: pendingAiLog.status
            }).catch((error) => console.error(`Create AI heal log failed: ${payload.jobNo}`, error));
          }

          if (stepStatus === "failed") {
            caseStatus = "failed";
            caseError = stepError;
            if (payload.config.screenshot) {
              const failurePage = await resolveArtifactPage(context, currentPage);
              await saveScreenshotArtifact({
                page: failurePage,
                payload,
                jobId,
                caseResultId,
                stepResultId,
                testCaseId: testCase.id,
                suffix: `step-${step.stepOrder}`
              });
            }
            break;
          }
        }
      } catch (error) {
        caseStatus = "failed";
        caseError = error instanceof Error ? error.message : String(error);
      } finally {
        const artifactPage = await resolveArtifactPage(context, currentPage);
        if (payload.config.screenshot) {
          await saveScreenshotArtifact({
            page: artifactPage,
            payload,
            jobId,
            caseResultId,
            testCaseId: testCase.id,
            suffix: "final"
          });
        }
        if (payload.config.trace) {
          const tracePath = path.join(jobArtifactDir(payload.jobNo), `case-${testCase.id}-trace.zip`);
          await context.tracing.stop({ path: tracePath });
          await createArtifact({
            projectId: payload.projectId,
            jobId,
            caseResultId,
            artifactType: "trace",
            storagePath: tracePath,
            fileName: path.basename(tracePath),
            contentType: "application/zip",
            fileSize: await fileSize(tracePath)
          });
        }
        if (artifactPage && !artifactPage.isClosed()) {
          await artifactPage.bringToFront().catch(() => undefined);
          await artifactPage.waitForTimeout(1200).catch(() => undefined);
        }
        const videoEntries: Array<{ video: Video; pageUrl: string; pageTitle: string; score: number }> = [];
        for (const trackedPage of trackedPages) {
          const video = trackedPage.video() as Video | null;
          if (!video || trackedPage.isClosed()) {
            continue;
          }
          const score = await pageArtifactScore(trackedPage);
          if (score <= 0) {
            continue;
          }
          videoEntries.push({
            video,
            pageUrl: trackedPage.url(),
            pageTitle: await trackedPage.title().catch(() => ""),
            score
          });
        }
        videoEntries.sort((a, b) => b.score - a.score);
        await context.close();
        for (const [index, entry] of videoEntries.entries()) {
          const videoPath = await entry.video.path().catch(() => undefined);
          if (videoPath) {
            await createArtifact({
              projectId: payload.projectId,
              jobId,
              caseResultId,
              artifactType: "video",
              storagePath: videoPath,
              fileName: `${index === 0 ? "main" : `page-${index + 1}`}-${path.basename(videoPath)}`,
              contentType: "video/webm",
              fileSize: await fileSize(videoPath)
            });
          }
        }
      }

      if (caseStatus === "passed") {
        counts.passed += 1;
      } else {
        counts.failed += 1;
      }
      await finishCaseResult(caseResultId, caseStatus, Date.now() - caseStart, caseError);
      await redis.hmset(`test-platform:execution:${payload.jobNo}:status`, {
        passedCases: String(counts.passed),
        failedCases: String(counts.failed),
        updatedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    jobError = error instanceof Error ? error.message : String(error);
    counts.failed += counts.passed + counts.failed === 0 ? payload.caseIds.length : 0;
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    if (jobId) {
      const finalStatus = counts.failed > 0 || jobError ? "failed" : "passed";
      await markJobFinished(jobId, finalStatus, counts, jobError);
      await redis.hmset(`test-platform:execution:${payload.jobNo}:status`, {
        status: finalStatus,
        passedCases: String(counts.passed),
        failedCases: String(counts.failed),
        finishedAt: new Date().toISOString(),
        errorMessage: jobError ?? ""
      });
    }
    const currentLock = await redis.get(lockKey);
    if (currentLock === lockValue) {
      await redis.del(lockKey);
    }
  }
}

async function heartbeatLoop(): Promise<void> {
  while (!shuttingDown) {
    await redis.hmset(`test-platform:worker:${workerId}:heartbeat`, {
      workerId,
      pid: String(process.pid),
      status: "online",
      updatedAt: new Date().toISOString()
    });
    await redis.expire(`test-platform:worker:${workerId}:heartbeat`, 90);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

async function workerLoop(): Promise<void> {
  if (redis.status === "wait") {
    await redis.connect();
  }
  if (blockingRedis.status === "wait") {
    await blockingRedis.connect();
  }
  void heartbeatLoop().catch((error) => console.error("Heartbeat failed", error));

  console.log(`Playwright worker started: ${workerId}`);
  while (!shuttingDown) {
    const item = await blockingRedis.brpop(QUEUE_KEY, 5);
    if (!item) {
      continue;
    }
    const [, rawPayload] = item;
    const payload = parsePayload(rawPayload);
    try {
      console.log(`Start job: ${payload.jobNo}`);
      await runPayload(payload);
      console.log(`Finish job: ${payload.jobNo}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Job failed: ${payload.jobNo}`, message);
      await markJobFailedByNo(payload.jobNo, payload.caseIds.length, message).catch((markError) =>
        console.error(`Mark failed job error: ${payload.jobNo}`, markError)
      );
      await redis.lpush(
        FAILED_QUEUE_KEY,
        JSON.stringify({
          payload,
          error: message,
          failedAt: new Date().toISOString()
        })
      );
    }
  }
}

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

workerLoop()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await blockingRedis.quit().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await mysqlPool.end().catch(() => undefined);
  });
