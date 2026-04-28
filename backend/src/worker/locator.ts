import type { Locator, Page } from "playwright";
import { parseJson } from "../utils/json.js";
import type { CaseStepRecord } from "./types.js";

interface RoleLocatorValue {
  role?: string;
  name?: string;
}

export type LocatorCandidateSource =
  | "step_primary"
  | "step_snapshot"
  | "element_candidate"
  | "ai_candidate"
  | "ai_visual";

export interface LocatorCandidate {
  id?: number;
  locatorType: string;
  locatorValue: string;
  locatorExpression: string | null;
  score?: number;
  isPrimary?: boolean;
  source: LocatorCandidateSource;
  status?: string;
  priority?: number;
  confidence?: number;
  successCount?: number;
  failedCount?: number;
}

export interface LocatorAttempt extends LocatorCandidate {
  resolution: "primary" | "fallback";
  candidateIndex: number;
  candidateTotal: number;
  success: boolean;
  errorMessage?: string;
}

export interface ResolvedLocatorMatch extends LocatorCandidate {
  resolution: "primary" | "fallback";
  candidateIndex: number;
  candidateTotal: number;
}

export class LocatorFallbackError extends Error {
  attempts: LocatorAttempt[];

  constructor(message: string, attempts: LocatorAttempt[]) {
    super(message);
    this.name = "LocatorFallbackError";
    this.attempts = attempts;
  }
}

export function buildLocator(page: Page, locatorType: string, locatorValue: string): Locator {
  const type = locatorType.toLowerCase();
  if (type === "testid" || type === "test-id" || type === "test_id" || type === "get_by_test_id") {
    return page.getByTestId(locatorValue);
  }
  if (type === "role" || type === "get_by_role") {
    const value = parseJson<RoleLocatorValue>(locatorValue, { role: locatorValue });
    if (!value.role) {
      throw new Error("Role locator is missing the role field");
    }
    return page.getByRole(value.role as Parameters<Page["getByRole"]>[0], {
      name: value.name
    });
  }
  if (type === "label") {
    return page.getByLabel(locatorValue);
  }
  if (type === "placeholder") {
    return page.getByPlaceholder(locatorValue);
  }
  if (type === "text" || type === "get_by_text") {
    return page.getByText(locatorValue);
  }
  if (type === "xpath" || type === "relativexpath" || type === "relative_xpath") {
    return page.locator(`xpath=${locatorValue}`);
  }
  return page.locator(locatorValue);
}

function normalizeCandidate(
  locator: Record<string, unknown>,
  source: LocatorCandidate["source"],
  defaultPrimary = false
): LocatorCandidate | null {
  const locatorType = String(locator.locatorType ?? locator.type ?? "").trim();
  const rawValue = locator.locatorValue ?? locator.value ?? "";
  const locatorValue =
    typeof rawValue === "string" ? rawValue.trim() : rawValue ? JSON.stringify(rawValue) : "";
  if (!locatorType || !locatorValue) {
    return null;
  }
  return {
    id: Number.isInteger(locator.id) ? Number(locator.id) : undefined,
    locatorType,
    locatorValue,
    locatorExpression: typeof locator.locatorExpression === "string" ? locator.locatorExpression : null,
    score: typeof locator.score === "number" ? locator.score : undefined,
    isPrimary: typeof locator.isPrimary === "boolean" ? locator.isPrimary : defaultPrimary,
    source,
    status: typeof locator.status === "string" ? locator.status : undefined,
    priority: typeof locator.priority === "number" ? locator.priority : undefined,
    confidence: typeof locator.confidence === "number" ? locator.confidence : undefined,
    successCount: typeof locator.successCount === "number" ? locator.successCount : undefined,
    failedCount: typeof locator.failedCount === "number" ? locator.failedCount : undefined
  };
}

function snapshotCandidates(snapshot: CaseStepRecord["locatorSnapshot"]): LocatorCandidate[] {
  if (Array.isArray(snapshot)) {
    return snapshot
      .map((locator, index) => normalizeCandidate(locator, "step_snapshot", index === 0))
      .filter((locator): locator is LocatorCandidate => Boolean(locator));
  }
  if (snapshot && typeof snapshot === "object") {
    const candidate = normalizeCandidate(snapshot, "step_snapshot", true);
    return candidate ? [candidate] : [];
  }
  return [];
}

export function collectLocatorCandidates(
  step: Pick<
    CaseStepRecord,
    "locatorSnapshot" | "locatorType" | "locatorValue" | "locatorExpression" | "locatorCandidates" | "locatorId"
  >
): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];

  if (step.locatorType && step.locatorValue) {
    candidates.push({
      id: step.locatorId ?? undefined,
      locatorType: step.locatorType,
      locatorValue: step.locatorValue,
      locatorExpression: step.locatorExpression ?? null,
      isPrimary: true,
      source: "step_primary"
    });
  }

  candidates.push(...snapshotCandidates(step.locatorSnapshot));

  for (const locator of step.locatorCandidates || []) {
    const source =
      locator.source === "ai_candidate" ? "ai_candidate" : locator.source === "ai_visual" ? "ai_visual" : "element_candidate";
    const candidate = normalizeCandidate(locator as Record<string, unknown>, source);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const deduped: LocatorCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.locatorType.toLowerCase()}::${candidate.locatorValue}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  if (!deduped.length) {
    throw new Error("Step does not have any locator candidates");
  }
  if (!deduped.some((candidate) => candidate.isPrimary)) {
    deduped[0].isPrimary = true;
  }
  return deduped;
}

function formatLocator(candidate: LocatorCandidate): string {
  return `${candidate.locatorType}=${candidate.locatorValue}`;
}

function summarizeFailureReason(message: string): string {
  if (/strict mode violation/i.test(message)) {
    return "strict match conflict";
  }
  if (/not visible|element is not visible/i.test(message)) {
    return "element not visible";
  }
  if (/Timeout \d+ms exceeded|timeout/i.test(message)) {
    return "timeout";
  }
  if (/not enabled|element is disabled/i.test(message)) {
    return "element disabled";
  }
  if (/detached|not attached/i.test(message)) {
    return "element detached";
  }
  return "locator failed";
}

export async function withLocatorFallback<T>(
  page: Page,
  step: Pick<
    CaseStepRecord,
    "locatorSnapshot" | "locatorType" | "locatorValue" | "locatorExpression" | "locatorCandidates" | "locatorId"
  >,
  executor: (locator: Locator, candidate: LocatorCandidate) => Promise<T>
): Promise<{ result: T; matchedLocator: ResolvedLocatorMatch; attempts: LocatorAttempt[] }> {
  const candidates = collectLocatorCandidates(step);
  const attempts: LocatorAttempt[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const resolution = index === 0 ? "primary" : "fallback";
    try {
      const locator = buildLocator(page, candidate.locatorType, candidate.locatorValue);
      const result = await executor(locator, candidate);
      const matchedLocator: ResolvedLocatorMatch = {
        ...candidate,
        resolution,
        candidateIndex: index + 1,
        candidateTotal: candidates.length
      };
      attempts.push({
        ...matchedLocator,
        success: true
      });
      return {
        result,
        matchedLocator,
        attempts
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({
        ...candidate,
        resolution,
        candidateIndex: index + 1,
        candidateTotal: candidates.length,
        success: false,
        errorMessage: message
      });
    }
  }

  const summary = attempts
    .map((attempt) => `${formatLocator(attempt)}: ${summarizeFailureReason(attempt.errorMessage || "")}`)
    .join("; ");
  throw new LocatorFallbackError(`All locator candidates failed (${attempts.length} attempts). ${summary}`, attempts);
}

export function resolveLocatorFromStep(
  page: Page,
  step: Pick<
    CaseStepRecord,
    "locatorSnapshot" | "locatorType" | "locatorValue" | "locatorExpression" | "locatorCandidates" | "locatorId"
  >
): Locator {
  const primary = collectLocatorCandidates(step)[0];
  return buildLocator(page, primary.locatorType, primary.locatorValue);
}
