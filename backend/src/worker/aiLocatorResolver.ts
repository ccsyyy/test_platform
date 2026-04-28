import type { Page } from "playwright";
import {
  requestAiLocatorSuggestions,
  type AiLocatorSuggestion,
  type ProjectAiConfig
} from "../services/ai.js";
import type { LocatorAttempt } from "./locator.js";
import type { CaseStepRecord } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function locatorExpression(locatorType: string, locatorValue: string): string | null {
  const type = locatorType.toLowerCase();
  if (type === "testid" || type === "test-id" || type === "test_id" || type === "get_by_test_id") {
    return `page.getByTestId(${JSON.stringify(locatorValue)})`;
  }
  if (type === "role" || type === "get_by_role") {
    return `page.getByRole(${JSON.stringify(locatorValue)})`;
  }
  if (type === "label") {
    return `page.getByLabel(${JSON.stringify(locatorValue)})`;
  }
  if (type === "placeholder") {
    return `page.getByPlaceholder(${JSON.stringify(locatorValue)})`;
  }
  if (type === "text" || type === "get_by_text") {
    return `page.getByText(${JSON.stringify(locatorValue)})`;
  }
  if (type === "xpath" || type === "relativexpath" || type === "relative_xpath") {
    return `page.locator(${JSON.stringify(`xpath=${locatorValue}`)})`;
  }
  return `page.locator(${JSON.stringify(locatorValue)})`;
}

export interface AiLocatorResolutionContext {
  projectConfig: ProjectAiConfig;
  page: Page;
  step: CaseStepRecord;
  attempts: LocatorAttempt[];
}

export interface AiLocatorResolutionResult {
  aiInput: Record<string, unknown>;
  suggestions: AiLocatorSuggestion[];
  rejectedSuggestions: AiLocatorSuggestion[];
  candidates: CaseStepRecord["locatorCandidates"];
}

function locatorTypePriority(locatorType: string): number {
  const type = locatorType.toLowerCase();
  if (type === "get_by_role" || type === "role") return 1;
  if (type === "get_by_text" || type === "text") return 2;
  if (type === "get_by_test_id" || type === "testid" || type === "test_id") return 3;
  if (type === "css") return 4;
  if (type === "xpath" || type === "relativexpath" || type === "relative_xpath") return 5;
  return 99;
}

async function captureScreenshot(page: Page): Promise<string | undefined> {
  try {
    const buffer = await page.screenshot({
      fullPage: false,
      animations: "disabled"
    });
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function capturePageText(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const body = document.body;
      return body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 6000) || "";
    });
  } catch {
    return "";
  }
}

export async function resolveAiLocatorCandidates(
  input: AiLocatorResolutionContext
): Promise<AiLocatorResolutionResult> {
  const pageUrl = input.page.url();
  const pageTitle = await input.page.title().catch(() => "");
  const pageText = await capturePageText(input.page);
  const screenshot = await captureScreenshot(input.page);
  const elementSnapshot =
    asRecord(input.step.elementAttributes) ??
    (Array.isArray(input.step.locatorSnapshot)
      ? asRecord(input.step.locatorSnapshot[0])
      : asRecord(input.step.locatorSnapshot)) ??
    null;

  const aiInput = {
    action: input.step.action,
    stepName: input.step.stepName ?? "",
    elementName: input.step.elementName ?? "",
    pageName: input.step.pageName ?? "",
    componentName: input.step.componentName ?? "",
    pageUrl,
    pageTitle,
    pageTextPreview: pageText.slice(0, 1200),
    confidenceThreshold: input.projectConfig.aiLocatorConfidenceThreshold,
    locatorAttempts: input.attempts.map((attempt) => ({
      locatorType: attempt.locatorType,
      locatorValue: attempt.locatorValue,
      source: attempt.source,
      errorMessage: attempt.errorMessage ?? ""
    })),
    elementSnapshot: elementSnapshot ?? {}
  };

  const suggestions = await requestAiLocatorSuggestions({
    projectConfig: input.projectConfig,
    action: input.step.action,
    stepName: input.step.stepName,
    elementName: input.step.elementName,
    pageUrl,
    pageTitle,
    elementSnapshot,
    attempts: aiInput.locatorAttempts,
    pageText,
    imageDataUrl: screenshot
  });
  const threshold = Number(input.projectConfig.aiLocatorConfidenceThreshold || 70);
  const sortedSuggestions = suggestions
    .slice()
    .sort((left, right) => {
      const priorityDelta = locatorTypePriority(left.locatorType) - locatorTypePriority(right.locatorType);
      if (priorityDelta !== 0) return priorityDelta;
      return Number(right.confidence || 0) - Number(left.confidence || 0);
    });
  const acceptedSuggestions = sortedSuggestions.filter((suggestion) => Number(suggestion.confidence || 0) >= threshold);
  const rejectedSuggestions = sortedSuggestions.filter((suggestion) => Number(suggestion.confidence || 0) < threshold);

  const candidates: CaseStepRecord["locatorCandidates"] = acceptedSuggestions.map((suggestion, index) => ({
    locatorType: suggestion.locatorType,
    locatorValue: suggestion.locatorValue,
    locatorExpression:
      suggestion.locatorExpression ?? locatorExpression(suggestion.locatorType, suggestion.locatorValue),
    score: Math.round(Number(suggestion.confidence || 0)),
    confidence: Number(suggestion.confidence || 0),
    isPrimary: index === 0,
    source: "ai_candidate",
    status: "active",
    priority: 20 + locatorTypePriority(suggestion.locatorType) * 10 + index
  }));

  return {
    aiInput,
    suggestions: sortedSuggestions,
    rejectedSuggestions,
    candidates
  };
}
