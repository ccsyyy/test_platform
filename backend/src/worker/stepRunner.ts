import type { Page } from "playwright";
import { expect } from "playwright/test";
import { type LocatorAttempt, type ResolvedLocatorMatch, withLocatorFallback } from "./locator.js";
import type { CaseStepRecord } from "./types.js";

function getParams(step: CaseStepRecord): Record<string, unknown> {
  const params = step.stepDsl.params;
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function getString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`Step parameter "${name}" must be a string`);
  }
  return value;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function currentUrlPattern(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname || "/"}${url.search || ""}${url.hash || ""}`;
  } catch {
    return String(value || "");
  }
}

export interface StepRunResult {
  matchedLocator?: ResolvedLocatorMatch;
  locatorAttempts?: LocatorAttempt[];
  page?: Page;
}

function latestLivePage(page: Page): Page {
  const livePages = page
    .context()
    .pages()
    .filter((candidate) => !candidate.isClosed());
  return livePages[livePages.length - 1] ?? page;
}

async function settleLivePage(page: Page, options?: { waitForNetworkIdle?: boolean; delayMs?: number }): Promise<Page> {
  const livePage = latestLivePage(page);
  await livePage.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => undefined);
  await livePage.waitForLoadState("load", { timeout: 4000 }).catch(() => undefined);
  if (options?.waitForNetworkIdle) {
    await livePage.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
  }
  await livePage
    .waitForFunction(
      () => document.readyState === "interactive" || document.readyState === "complete",
      undefined,
      { timeout: 1500 }
    )
    .catch(() => undefined);
  await livePage
    .evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    )
    .catch(() => undefined);
  await livePage.waitForTimeout(options?.delayMs ?? 450).catch(() => undefined);
  return latestLivePage(livePage);
}

async function waitForPopup(page: Page, timeout = 1200): Promise<Page | undefined> {
  return page
    .context()
    .waitForEvent("page", { timeout })
    .then(async (popup) => {
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
      return popup;
    })
    .catch(() => undefined);
}

async function waitForExpectedUrl(page: Page, step: CaseStepRecord): Promise<Page> {
  const params = getParams(step);
  const expectedPattern = typeof params.waitForUrlPattern === "string" ? params.waitForUrlPattern.trim() : "";
  if (!expectedPattern) {
    return latestLivePage(page);
  }
  const activePage = latestLivePage(page);
  const timeout = getNumber(params.waitForNavigationTimeoutMs, 15000);
  try {
    await activePage.waitForFunction(
      (expected) => `${window.location.pathname || "/"}${window.location.search || ""}${window.location.hash || ""}` === expected,
      expectedPattern,
      { timeout }
    );
  } catch (error) {
    const currentPattern = currentUrlPattern(activePage.url());
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Expected navigation to "${expectedPattern}" but stayed on "${currentPattern}". ${message}`);
  }
  return latestLivePage(activePage);
}

async function runAssertion(page: Page, step: CaseStepRecord): Promise<StepRunResult> {
  const params = getParams(step);
  const assertType = typeof params.type === "string" ? params.type : "visible";
  const timeout = getNumber(params.timeout, 5000);

  if (assertType === "url") {
    await expect(page).toHaveURL(new RegExp(getString(params.pattern, "pattern")), { timeout });
    return { page: latestLivePage(page), locatorAttempts: [] };
  }

  if (assertType === "hidden") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (locator) => {
      await expect(locator).toBeHidden({ timeout });
    });
    return { matchedLocator, locatorAttempts: attempts, page: latestLivePage(page) };
  }
  if (assertType === "text") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (locator) => {
      await expect(locator).toHaveText(getString(params.text, "text"), { timeout });
    });
    return { matchedLocator, locatorAttempts: attempts, page: latestLivePage(page) };
  }
  if (assertType === "containsText") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (locator) => {
      await expect(locator).toContainText(getString(params.text, "text"), { timeout });
    });
    return { matchedLocator, locatorAttempts: attempts, page: latestLivePage(page) };
  }
  if (assertType === "value") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (locator) => {
      await expect(locator).toHaveValue(getString(params.value, "value"), { timeout });
    });
    return { matchedLocator, locatorAttempts: attempts, page: latestLivePage(page) };
  }
  const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (locator) => {
    await expect(locator).toBeVisible({ timeout });
  });
  return { matchedLocator, locatorAttempts: attempts, page: latestLivePage(page) };
}

async function runPointerAction(
  page: Page,
  step: CaseStepRecord,
  action: (page: Page) => Promise<{ matchedLocator?: ResolvedLocatorMatch; attempts?: LocatorAttempt[] }>
): Promise<StepRunResult> {
  const popupPromise = waitForPopup(page);
  const result = await action(page);
  const popup = await popupPromise;
  const activePage = popup && !popup.isClosed() ? popup : latestLivePage(page);
  const navigatedPage = await waitForExpectedUrl(activePage, step);
  const settledPage = await settleLivePage(navigatedPage, {
    waitForNetworkIdle: true,
    delayMs: 700
  });
  return {
    matchedLocator: result.matchedLocator,
    locatorAttempts: result.attempts ?? [],
    page: settledPage
  };
}

export async function runStep(page: Page, step: CaseStepRecord, baseUrl?: string): Promise<StepRunResult> {
  const params = getParams(step);
  const action = step.action.toLowerCase();

  if (action === "goto") {
    const rawUrl = getString(params.url, "url");
    const url = rawUrl.startsWith("http") || !baseUrl ? rawUrl : new URL(rawUrl, baseUrl).toString();
    const targetPattern = currentUrlPattern(url);
    if (params.skipIfAlreadyOnUrlPattern === true && currentUrlPattern(page.url()) === targetPattern) {
      return {
        page: await settleLivePage(page, {
          waitForNetworkIdle: true,
          delayMs: 400
        }),
        locatorAttempts: []
      };
    }
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return {
      page: await settleLivePage(page, {
        waitForNetworkIdle: true,
        delayMs: 800
      }),
      locatorAttempts: []
    };
  }

  if (action === "wait") {
    const timeout = getNumber(params.timeout, 1000);
    const state = typeof params.state === "string" ? params.state : undefined;
    if (state === "visible") {
      const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (locator) => {
        await locator.waitFor({ state: "visible", timeout });
      });
      return {
        matchedLocator,
        locatorAttempts: attempts,
        page: await settleLivePage(page)
      };
    }
    if (state === "hidden") {
      const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (locator) => {
        await locator.waitFor({ state: "hidden", timeout });
      });
      return {
        matchedLocator,
        locatorAttempts: attempts,
        page: await settleLivePage(page)
      };
    }
    await page.waitForTimeout(timeout);
    return { page: await settleLivePage(page), locatorAttempts: [] };
  }

  if (action === "assert") {
    return runAssertion(page, step);
  }

  if (action === "click") {
    return runPointerAction(page, step, async (currentPage) => {
      const { matchedLocator, attempts } = await withLocatorFallback(currentPage, step, async (targetLocator) => {
        await targetLocator.click();
      });
      return { matchedLocator, attempts };
    });
  }
  if (action === "dblclick") {
    return runPointerAction(page, step, async (currentPage) => {
      const { matchedLocator, attempts } = await withLocatorFallback(currentPage, step, async (targetLocator) => {
        await targetLocator.dblclick();
      });
      return { matchedLocator, attempts };
    });
  }
  if (action === "rightclick") {
    return runPointerAction(page, step, async (currentPage) => {
      const { matchedLocator, attempts } = await withLocatorFallback(currentPage, step, async (targetLocator) => {
        await targetLocator.click({ button: "right" });
      });
      return { matchedLocator, attempts };
    });
  }
  if (action === "fill") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (targetLocator) => {
      await targetLocator.fill(getString(params.value, "value"));
    });
    const navigatedPage = await waitForExpectedUrl(page, step);
    return {
      matchedLocator,
      locatorAttempts: attempts,
      page: await settleLivePage(navigatedPage, { delayMs: 250 })
    };
  }
  if (action === "press") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (targetLocator) => {
      await targetLocator.press(getString(params.key, "key"));
    });
    const navigatedPage = await waitForExpectedUrl(page, step);
    return {
      matchedLocator,
      locatorAttempts: attempts,
      page: await settleLivePage(navigatedPage, { waitForNetworkIdle: true, delayMs: 500 })
    };
  }
  if (action === "select") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (targetLocator) => {
      await targetLocator.selectOption(getString(params.value, "value"));
    });
    const navigatedPage = await waitForExpectedUrl(page, step);
    return {
      matchedLocator,
      locatorAttempts: attempts,
      page: await settleLivePage(navigatedPage, { waitForNetworkIdle: true, delayMs: 400 })
    };
  }
  if (action === "check") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (targetLocator) => {
      await targetLocator.check();
    });
    const navigatedPage = await waitForExpectedUrl(page, step);
    return {
      matchedLocator,
      locatorAttempts: attempts,
      page: await settleLivePage(navigatedPage, { delayMs: 250 })
    };
  }
  if (action === "uncheck") {
    const { matchedLocator, attempts } = await withLocatorFallback(page, step, async (targetLocator) => {
      await targetLocator.uncheck();
    });
    const navigatedPage = await waitForExpectedUrl(page, step);
    return {
      matchedLocator,
      locatorAttempts: attempts,
      page: await settleLivePage(navigatedPage, { delayMs: 250 })
    };
  }

  throw new Error(`Unsupported step action: ${step.action}`);
}
