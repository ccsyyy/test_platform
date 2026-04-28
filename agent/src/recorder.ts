import { chromium, type Browser, type Page } from "playwright";
import { uploadRecordingEvent } from "./api.js";

declare global {
  interface Window {
    __testPlatformCapture?: (event: CapturedEvent & { eventOrder: number }) => void;
    __testPlatformRecorderInjected?: boolean;
  }
}

interface CapturedEvent {
  eventType: string;
  action?: string;
  url: string;
  elementSnapshot?: Record<string, unknown>;
  locators?: Array<Record<string, unknown>>;
  inputValueMasked?: string;
  eventTime?: string;
}

export interface RecorderOptions {
  apiBaseUrl: string;
  token: string;
  sessionNo: string;
  startUrl: string;
  environmentId?: number;
  browser: "chrome" | "edge" | "chromium";
  headless: boolean;
  autoDemo?: boolean;
}

export interface RecorderHandle {
  stop: () => Promise<void>;
  done: Promise<void>;
}

function browserChannel(browser: RecorderOptions["browser"]): "chrome" | "msedge" | undefined {
  if (browser === "chrome") {
    return "chrome";
  }
  if (browser === "edge") {
    return "msedge";
  }
  return undefined;
}

async function launchBrowser(options: RecorderOptions): Promise<Browser> {
  const channel = browserChannel(options.browser);
  return chromium.launch({
    channel,
    headless: options.headless
  });
}

function injectionScript() {
  if (window.__testPlatformRecorderInjected) {
    return;
  }
  window.__testPlatformRecorderInjected = true;

  function escapeJsString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function xpathLiteral(value: string): string {
    if (!value.includes("'")) {
      return `'${value}'`;
    }
    if (!value.includes('"')) {
      return `"${value}"`;
    }
    const parts = value.split("'");
    return `concat(${parts.map((part) => `'${part}'`).join(`, "'", `)})`;
  }

  function cssPath(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
      const tag = current.tagName.toLowerCase();
      const id = current.getAttribute("id");
      if (id) {
        parts.unshift(`${tag}#${CSS.escape(id)}`);
        break;
      }
      const testId =
        current.getAttribute("data-testid") ||
        current.getAttribute("data-test") ||
        current.getAttribute("data-qa");
      if (testId) {
        const attributeName = current.getAttribute("data-testid")
          ? "data-testid"
          : current.getAttribute("data-test")
            ? "data-test"
            : "data-qa";
        parts.unshift(`${tag}[${attributeName}="${CSS.escape(testId)}"]`);
        break;
      }
      const parent: Element | null = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter(
        (child): child is Element => child instanceof Element && child.tagName === current!.tagName
      );
      const index = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      current = parent;
    }
    return parts.join(" > ");
  }

  function xpathPath(element: Element): string {
    const id = element.getAttribute("id");
    if (id) {
      return `//*[@id=${xpathLiteral(id)}]`;
    }
    const testId =
      element.getAttribute("data-testid") ||
      element.getAttribute("data-test") ||
      element.getAttribute("data-qa");
    if (testId) {
      const attributeName = element.getAttribute("data-testid")
        ? "data-testid"
        : element.getAttribute("data-test")
          ? "data-test"
          : "data-qa";
      return `//*[@${attributeName}=${xpathLiteral(testId)}]`;
    }

    const segments: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const currentElement: Element = current;
      const tag = currentElement.tagName.toLowerCase();
      const parent: HTMLElement | null = currentElement.parentElement;
      if (!parent) {
        segments.unshift(tag);
        break;
      }
      const siblingTag = currentElement.tagName;
      const siblings = Array.from(parent.children).filter(
        (child): child is Element => child instanceof Element && child.tagName === siblingTag
      );
      const index = siblings.indexOf(currentElement) + 1;
      segments.unshift(`${tag}[${index}]`);
      current = parent;
    }
    return `/${segments.join("/")}`;
  }

  function isBridgeHost(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    return tag === "wujie-app" || tag === "micro-app";
  }

  const interactiveSelector = [
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "option",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="option"]',
    "[data-testid]",
    "[data-test]",
    "[data-qa]",
    "[data-action]",
    "[data-command]",
    "[aria-controls]",
    "[aria-expanded]",
    "[tabindex]",
    "[onclick]",
    '[contenteditable="true"]'
  ].join(",");

  function normalizeEventElement(value: unknown): Element | null {
    if (value instanceof Element) {
      return value;
    }
    if (value instanceof Text) {
      return value.parentElement;
    }
    return null;
  }

  function isInteractiveTag(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    return ["button", "a", "input", "textarea", "select", "option", "summary", "label"].includes(tag);
  }

  function hasInteractiveRole(element: Element): boolean {
    const role = (element.getAttribute("role") || "").toLowerCase();
    return ["button", "link", "checkbox", "radio", "textbox", "combobox", "menuitem", "tab", "switch", "option"].includes(role);
  }

  function isMeaningfulContainer(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    return ["div", "span", "li", "td", "th"].includes(tag);
  }

  function isContentEditableElement(element: Element): boolean {
    return element instanceof HTMLElement && element.isContentEditable;
  }

  function hasPointerIntent(element: Element): boolean {
    const htmlElement = element instanceof HTMLElement ? element : null;
    const cursor = htmlElement ? window.getComputedStyle(htmlElement).cursor : "";
    return (
      cursor === "pointer" ||
      element.hasAttribute("data-action") ||
      element.hasAttribute("data-command") ||
      element.hasAttribute("aria-controls") ||
      element.hasAttribute("aria-expanded")
    );
  }

  function elementAreaPenalty(element: Element): number {
    const rect = element.getBoundingClientRect();
    const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
    const areaRatio = (rect.width * rect.height) / viewportArea;
    if (areaRatio > 0.75) return -160;
    if (areaRatio > 0.5) return -110;
    if (areaRatio > 0.25) return -70;
    return 0;
  }

  function elementSignalScore(element: Element): number {
    let score = 0;
    const tag = element.tagName.toLowerCase();
    const textLength = (element.textContent || "").trim().replace(/\s+/g, " ").length;
    const testId =
      element.getAttribute("data-testid") ||
      element.getAttribute("data-test") ||
      element.getAttribute("data-qa");

    if (isInteractiveTag(element)) score += 120;
    if (tag === "a" && element.getAttribute("href")) score += 60;
    if (tag === "input" || tag === "textarea" || tag === "select") score += 45;
    if (hasInteractiveRole(element)) score += 80;
    if (testId) score += 55;
    if (element.getAttribute("id")) score += 18;
    if (element.getAttribute("name")) score += 12;
    if (element.getAttribute("placeholder")) score += 28;
    if (primaryLabelText(element)) score += 24;
    if (element.hasAttribute("onclick")) score += 35;
    if (element.hasAttribute("tabindex")) score += 20;
    if (element.getAttribute("contenteditable") === "true") score += 24;
    if (hasPointerIntent(element)) score += 26;
    if (isContentEditableElement(element)) score += 40;
    if (textLength > 0 && textLength <= 80) score += 14;
    if (isMeaningfulContainer(element) && !hasInteractiveRole(element) && !hasPointerIntent(element)) score -= 22;
    if (tag === "html" || tag === "body") score -= 400;

    return score + elementAreaPenalty(element);
  }

  function resolveLabelControl(element: Element): Element | null {
    if (!(element instanceof HTMLLabelElement)) {
      return null;
    }
    if (element.control instanceof Element) {
      return element.control;
    }
    const htmlFor = element.getAttribute("for");
    if (!htmlFor) {
      return null;
    }
    const control = document.getElementById(htmlFor);
    return control instanceof Element ? control : null;
  }

  function actionableAncestor(element: Element): Element {
    const directControl = resolveLabelControl(element);
    if (directControl) {
      return directControl;
    }
    const actionable = element.closest(interactiveSelector);
    if (actionable instanceof Element) {
      return resolveLabelControl(actionable) || actionable;
    }
    return element;
  }

  function uniqueElements(elements: Array<Element | null | undefined>): Element[] {
    const result: Element[] = [];
    const seen = new Set<Element>();
    for (const element of elements) {
      if (!(element instanceof Element) || seen.has(element) || isBridgeHost(element)) {
        continue;
      }
      seen.add(element);
      result.push(element);
    }
    return result;
  }

  function bestCandidate(elements: Element[]): Element | null {
    let winner: Element | null = null;
    let winnerScore = -Infinity;

    for (const [index, element] of elements.entries()) {
      const score = elementSignalScore(element) - index * 4;
      if (score > winnerScore) {
        winner = element;
        winnerScore = score;
      }
    }

    return winner;
  }

  function pointTarget(event: Event): Element | null {
    if (!(event instanceof MouseEvent)) {
      return null;
    }
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element instanceof Element ? element : null;
  }

  function captureTarget(event: Event): Element | null {
    const candidates: Element[] = [];
    const pointElement = pointTarget(event);
    if (pointElement) {
      candidates.push(pointElement, actionableAncestor(pointElement));
    }

    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      const element = normalizeEventElement(item);
      if (element && !isBridgeHost(element)) {
        candidates.push(element, actionableAncestor(element));
      }
    }
    const target = normalizeEventElement(event.target);
    if (target && !isBridgeHost(target)) {
      candidates.push(target, actionableAncestor(target));
    }

    const rankedCandidates = uniqueElements(candidates);
    return bestCandidate(rankedCandidates);
  }

  function labelledByText(element: Element): string {
    const ids = String(element.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => id.trim())
      .filter(Boolean);
    if (!ids.length) {
      return "";
    }
    return compactText(
      ids
        .map((id) => document.getElementById(id)?.textContent || "")
        .filter(Boolean)
        .join(" "),
      120
    );
  }

  function labelTexts(element: Element): string[] {
    const values = new Set<string>();
    const maybeControl = element as Element & { labels?: NodeListOf<HTMLLabelElement> | null };
    const nativeLabels = maybeControl.labels ? Array.from(maybeControl.labels) : [];
    for (const label of nativeLabels) {
      const text = compactText(label.textContent, 120);
      if (text) {
        values.add(text);
      }
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel instanceof HTMLLabelElement) {
      const text = compactText(wrappingLabel.textContent, 120);
      if (text) {
        values.add(text);
      }
    }
    const labelledBy = labelledByText(element);
    if (labelledBy) {
      values.add(labelledBy);
    }
    return Array.from(values);
  }

  function primaryLabelText(element: Element): string {
    return labelTexts(element)[0] || "";
  }

  function ariaLabelText(element: Element): string {
    return compactText(element.getAttribute("aria-label"), 120) || labelledByText(element);
  }

  function accessibleName(element: Element): string {
    const aria = ariaLabelText(element);
    if (aria) {
      return aria;
    }
    const label = primaryLabelText(element);
    if (label) {
      return label;
    }
    if (element instanceof HTMLInputElement && element.placeholder) {
      return element.placeholder.trim();
    }
    return (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
  }

  function roleOf(element: Element): string | undefined {
    const explicit = element.getAttribute("role");
    if (explicit) {
      return explicit;
    }
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (element instanceof HTMLInputElement) {
      if (["button", "submit", "reset"].includes(element.type)) return "button";
      if (["checkbox", "radio"].includes(element.type)) return element.type;
      if (element.type === "password") return undefined;
      return "textbox";
    }
    if (tag === "select") return "combobox";
    return undefined;
  }

  function compactText(value: string | null | undefined, maxLength = 200): string {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  }

  function classNames(element: Element): string[] {
    return Array.from(element.classList).filter(Boolean);
  }

  function dataTestIdOf(element: Element): string | null {
    return (
      element.getAttribute("data-testid") ||
      element.getAttribute("data-test") ||
      element.getAttribute("data-qa")
    );
  }

  function dataTestIdAttributeName(element: Element): string | null {
    if (element.hasAttribute("data-testid")) return "data-testid";
    if (element.hasAttribute("data-test")) return "data-test";
    if (element.hasAttribute("data-qa")) return "data-qa";
    return null;
  }

  function dataIdOf(element: Element): string | null {
    return element.getAttribute("data-id");
  }

  function isCaptchaKeyword(value: string | null | undefined): boolean {
    return /captcha|verify\s*code|verification\s*code|验证码|校验码|图形码|安全码/i.test(String(value || ""));
  }

  function compactCssSelector(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const id = element.getAttribute("id");
    if (id) {
      return `${tag}#${CSS.escape(id)}`;
    }

    const dataTestId = dataTestIdOf(element);
    if (dataTestId) {
      const attributeName = dataTestIdAttributeName(element) || "data-testid";
      return `${tag}[${attributeName}="${CSS.escape(dataTestId)}"]`;
    }

    const dataId = dataIdOf(element);
    if (dataId) {
      return `${tag}[data-id="${CSS.escape(dataId)}"]`;
    }

    const name = element.getAttribute("name");
    if (name) {
      return `${tag}[name="${CSS.escape(name)}"]`;
    }

    const classes = classNames(element)
      .filter((name) => /^[a-zA-Z][a-zA-Z0-9_-]{1,50}$/.test(name))
      .slice(0, 2);
    if (classes.length) {
      return `${tag}.${classes.map((name) => CSS.escape(name)).join(".")}`;
    }

    return cssPath(element);
  }

  function stepXPathFragment(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) {
      return tag;
    }
    const siblings = Array.from(parent.children).filter(
      (child): child is Element => child instanceof Element && child.tagName === element.tagName
    );
    const index = siblings.indexOf(element) + 1;
    return `${tag}[${Math.max(index, 1)}]`;
  }

  function anchoredXPath(element: Element): string | null {
    const id = element.getAttribute("id");
    if (id) {
      return `//*[@id=${xpathLiteral(id)}]`;
    }
    const dataTestId = dataTestIdOf(element);
    if (dataTestId) {
      const attributeName = element.getAttribute("data-testid")
        ? "data-testid"
        : element.getAttribute("data-test")
          ? "data-test"
          : "data-qa";
      return `//${element.tagName.toLowerCase()}[@${attributeName}=${xpathLiteral(dataTestId)}]`;
    }
    const dataId = dataIdOf(element);
    if (dataId) {
      return `//${element.tagName.toLowerCase()}[@data-id=${xpathLiteral(dataId)}]`;
    }
    const name = element.getAttribute("name");
    if (name) {
      return `//${element.tagName.toLowerCase()}[@name=${xpathLiteral(name)}]`;
    }
    return null;
  }

  function relativeXPath(element: Element): string {
    const selfAnchor = anchoredXPath(element);
    if (selfAnchor) {
      return selfAnchor;
    }

    const fragments: string[] = [];
    let current: Element | null = element;
    while (current) {
      const anchor = anchoredXPath(current);
      if (anchor) {
        return `${anchor}/${fragments.join("/")}`;
      }
      fragments.unshift(stepXPathFragment(current));
      current = current.parentElement;
    }

    return `//${fragments.join("/")}`;
  }

  function absoluteXPath(element: Element): string {
    const segments: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      segments.unshift(stepXPathFragment(current));
      current = current.parentElement;
    }
    return `/${segments.join("/")}`;
  }

  function elementValue(element: Element): string | null {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element instanceof HTMLInputElement && element.type === "password") {
        return "***";
      }
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      return element.value;
    }
    return element.getAttribute("value");
  }

  function isVisibleElement(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0"
    );
  }

  function isEditableElement(element: Element): boolean {
    if (element instanceof HTMLInputElement) {
      return !element.readOnly && !element.disabled;
    }
    if (element instanceof HTMLTextAreaElement) {
      return !element.readOnly && !element.disabled;
    }
    if (element instanceof HTMLSelectElement) {
      return !element.disabled;
    }
    const contentEditable = (element.getAttribute("contenteditable") || "").toLowerCase();
    return contentEditable === "true" || contentEditable === "" || contentEditable === "plaintext-only";
  }

  function rootNodeInfo(element: Element): {
    insideShadowDom: boolean;
    shadowHost: Record<string, unknown> | null;
  } {
    const root = element.getRootNode();
    if (!(root instanceof ShadowRoot)) {
      return {
        insideShadowDom: false,
        shadowHost: null
      };
    }

    const host = root.host instanceof Element ? root.host : null;
    return {
      insideShadowDom: true,
      shadowHost: host
        ? {
            tag: host.tagName.toLowerCase(),
            id: host.getAttribute("id"),
            name: host.getAttribute("name"),
            className: classNames(host).join(" "),
            compactCssSelector: compactCssSelector(host)
          }
        : null
    };
  }

  function frameElementInfo(frameElement: Element): Record<string, unknown> {
    return {
      tag: frameElement.tagName.toLowerCase(),
      id: frameElement.getAttribute("id"),
      name: frameElement.getAttribute("name"),
      className: classNames(frameElement).join(" "),
      dataTestId: dataTestIdOf(frameElement),
      dataId: dataIdOf(frameElement),
      src: frameElement.getAttribute("src"),
      compactCssSelector: compactCssSelector(frameElement),
      relativeXPath: relativeXPath(frameElement)
    };
  }

  function currentFramePath(): Array<Record<string, unknown>> {
    const path: Array<Record<string, unknown>> = [];
    let currentWindow: Window | null = window;

    while (currentWindow) {
      try {
        if (currentWindow === currentWindow.parent) {
          break;
        }
        const frameElement = currentWindow.frameElement;
        if (!(frameElement instanceof Element)) {
          break;
        }
        path.unshift(frameElementInfo(frameElement));
        currentWindow = currentWindow.parent;
      } catch {
        break;
      }
    }

    return path;
  }

  function environmentInfo(): Record<string, unknown> {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: Array.from(navigator.languages || []),
      cookieEnabled: navigator.cookieEnabled,
      devicePixelRatio: window.devicePixelRatio,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      screen: {
        width: window.screen?.width ?? null,
        height: window.screen?.height ?? null
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null
    };
  }

  function captureCaptchaContext(element: Element): {
    captchaImageLocator?: Record<string, unknown> | null;
    captchaRefreshLocator?: Record<string, unknown> | null;
    captchaHint?: string | null;
  } | null {
    const hint = primaryLabelText(element) || ariaLabelText(element) || compactText(element.getAttribute("placeholder"), 120);
    const isCaptchaElement = [
      hint,
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("class"),
      accessibleName(element)
    ].some((value) => isCaptchaKeyword(String(value || "")));
    if (!isCaptchaElement) {
      return null;
    }

    const targetRect = element.getBoundingClientRect();
    const roots: ParentNode[] = [];
    const nearestForm = element.closest("form");
    if (nearestForm) {
      roots.push(nearestForm);
    }
    let current: Element | null = element.parentElement;
    for (let depth = 0; current && depth < 4; depth += 1) {
      roots.push(current);
      current = current.parentElement;
    }
    roots.push(document);
    const uniqueRoots = Array.from(new Set(roots));

    function distanceScore(target: Element): number {
      const rect = target.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - (targetRect.left + targetRect.width / 2);
      const dy = rect.top + rect.height / 2 - (targetRect.top + targetRect.height / 2);
      const distance = Math.sqrt(dx * dx + dy * dy);
      return 180 - Math.min(distance, 360) / 2;
    }

    function captchaImageScore(target: Element): number {
      const rect = target.getBoundingClientRect();
      if (!isVisibleElement(target) || rect.width < 18 || rect.height < 12) {
        return -Infinity;
      }
      const tag = target.tagName.toLowerCase();
      const hintText = [
        target.getAttribute("alt"),
        target.getAttribute("title"),
        target.getAttribute("aria-label"),
        target.getAttribute("id"),
        target.getAttribute("class"),
        target.getAttribute("name"),
        target.getAttribute("src"),
        target.textContent
      ]
        .filter(Boolean)
        .join(" ");
      let score = distanceScore(target);
      if (tag === "img" || tag === "canvas") score += 80;
      if (tag === "svg") score += 40;
      if (isCaptchaKeyword(hintText)) score += 140;
      if (rect.width <= 320 && rect.height <= 160) score += 40;
      if (nearestForm && nearestForm.contains(target)) score += 30;
      return score;
    }

    let bestImage: Element | null = null;
    let bestImageScore = -Infinity;
    for (const root of uniqueRoots) {
      const candidates = Array.from(root.querySelectorAll("img,canvas,svg,[role='img'],[data-captcha-image]"));
      for (const candidate of candidates) {
        if (!(candidate instanceof Element) || candidate === element) {
          continue;
        }
        const score = captchaImageScore(candidate);
        if (score > bestImageScore) {
          bestImage = candidate;
          bestImageScore = score;
        }
      }
      if (bestImage) {
        break;
      }
    }

    function refreshScore(target: Element): number {
      if (!isVisibleElement(target) || target === element || target === bestImage) {
        return -Infinity;
      }
      const text = [
        target.textContent,
        target.getAttribute("aria-label"),
        target.getAttribute("title"),
        target.getAttribute("id"),
        target.getAttribute("class"),
        target.getAttribute("name")
      ]
        .filter(Boolean)
        .join(" ");
      const hasRefreshKeyword = /refresh|reload|change|another|换一张|刷新|看不清|重新获取/i.test(text);
      const tag = target.tagName.toLowerCase();
      let score = distanceScore(target);
      if (hasRefreshKeyword) score += 160;
      if (["button", "a", "img", "svg"].includes(tag)) score += 40;
      if ((target.getAttribute("role") || "").toLowerCase() === "button") score += 40;
      if (target.hasAttribute("onclick")) score += 24;
      return score;
    }

    let bestRefresh: Element | null = null;
    let bestRefreshScore = -Infinity;
    for (const root of uniqueRoots) {
      const candidates = Array.from(
        root.querySelectorAll("button,a,[role='button'],[onclick],[tabindex],img,svg,span,div")
      );
      for (const candidate of candidates) {
        if (!(candidate instanceof Element)) {
          continue;
        }
        const score = refreshScore(candidate);
        if (score > bestRefreshScore) {
          bestRefresh = candidate;
          bestRefreshScore = score;
        }
      }
      if (bestRefresh && bestRefreshScore >= 120) {
        break;
      }
    }

    return {
      captchaImageLocator: bestImage ? locators(bestImage)[0] || null : null,
      captchaRefreshLocator: bestRefresh && bestRefreshScore >= 120 ? locators(bestRefresh)[0] || null : null,
      captchaHint: hint || null
    };
  }

  function snapshot(element: Element): Record<string, unknown> {
    const rect = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();
    const dataTestId = dataTestIdOf(element);
    const shadowInfo = rootNodeInfo(element);
    const labels = labelTexts(element);
    const captchaContext = captureCaptchaContext(element);
    const position = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    const framePath = currentFramePath();
    const envInfo = environmentInfo();
    return {
      tag,
      tagName: tag,
      text: compactText(element.textContent, 200),
      id: element.getAttribute("id"),
      name: element.getAttribute("name"),
      className: classNames(element).join(" "),
      classList: classNames(element),
      type: element.getAttribute("type"),
      role: roleOf(element),
      label: labels[0] || "",
      labels,
      ariaLabel: ariaLabelText(element),
      accessibleName: accessibleName(element),
      testId: dataTestId,
      dataTestId,
      dataId: dataIdOf(element),
      placeholder: element.getAttribute("placeholder"),
      href: element.getAttribute("href"),
      src: element.getAttribute("src"),
      value: elementValue(element),
      disabled: element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLOptionElement
          ? element.disabled
          : element.hasAttribute("disabled"),
      checked:
        element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")
          ? element.checked
          : null,
      visible: isVisibleElement(element),
      editable: isEditableElement(element),
      compactCssSelector: compactCssSelector(element),
      relativeXPath: relativeXPath(element),
      absoluteXPath: absoluteXPath(element),
      pageUrl: window.location.href,
      pageTitle: document.title || "",
      pageLoadState: document.readyState,
      iframePath: framePath,
      insideShadowDom: shadowInfo.insideShadowDom,
      shadowDomExists: shadowInfo.insideShadowDom,
      shadowHost: shadowInfo.shadowHost,
      captchaImageLocator: captchaContext?.captchaImageLocator ?? null,
      captchaRefreshLocator: captchaContext?.captchaRefreshLocator ?? null,
      captchaHint: captchaContext?.captchaHint ?? null,
      environmentInfo: envInfo,
      elementState: {
        disabled: element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLOptionElement
            ? element.disabled
            : element.hasAttribute("disabled"),
        checked:
          element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")
            ? element.checked
            : null,
        visible: isVisibleElement(element),
        editable: isEditableElement(element)
      },
      pageInfo: {
        url: window.location.href,
        title: document.title || "",
        loadState: document.readyState,
        iframePath: framePath
      },
      position,
      rect: {
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height
      }
    };
  }

  function locators(element: Element): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    const testId = dataTestIdOf(element);
    if (testId) {
      const attributeName = dataTestIdAttributeName(element);
      if (attributeName === "data-testid") {
        result.push({
          locatorType: "testId",
          locatorValue: testId,
          locatorExpression: `page.getByTestId('${escapeJsString(testId)}')`,
          score: 100,
          isPrimary: true
        });
      } else if (attributeName) {
        const selector = `${element.tagName.toLowerCase()}[${attributeName}="${CSS.escape(testId)}"]`;
        result.push({
          locatorType: "css",
          locatorValue: selector,
          locatorExpression: `page.locator('${escapeJsString(selector)}')`,
          score: 96,
          isPrimary: true
        });
      }
    }
    const id = element.getAttribute("id");
    if (id) {
      const selector = `${element.tagName.toLowerCase()}#${CSS.escape(id)}`;
      result.push({
        locatorType: "css",
        locatorValue: selector,
        locatorExpression: `page.locator('${escapeJsString(selector)}')`,
        score: 95,
        isPrimary: result.length === 0
      });
    }
    const fieldName = element.getAttribute("name");
    if (fieldName) {
      const selector = `${element.tagName.toLowerCase()}[name="${CSS.escape(fieldName)}"]`;
      result.push({
        locatorType: "css",
        locatorValue: selector,
        locatorExpression: `page.locator('${escapeJsString(selector)}')`,
        score: 94,
        isPrimary: result.length === 0
      });
    }
    const dataId = dataIdOf(element);
    if (dataId) {
      const selector = `${element.tagName.toLowerCase()}[data-id="${CSS.escape(dataId)}"]`;
      result.push({
        locatorType: "css",
        locatorValue: selector,
        locatorExpression: `page.locator('${escapeJsString(selector)}')`,
        score: 92,
        isPrimary: result.length === 0
      });
    }
    const labelText = primaryLabelText(element);
    if (labelText) {
      result.push({
        locatorType: "label",
        locatorValue: labelText,
        locatorExpression: `page.getByLabel('${escapeJsString(labelText)}')`,
        score: 91,
        isPrimary: result.length === 0
      });
    }
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) {
      result.push({
        locatorType: "placeholder",
        locatorValue: placeholder,
        locatorExpression: `page.getByPlaceholder('${escapeJsString(placeholder)}')`,
        score: 90,
        isPrimary: result.length === 0
      });
    }
    const href = element.getAttribute("href");
    if (href) {
      const selector = `${element.tagName.toLowerCase()}[href="${CSS.escape(href)}"]`;
      result.push({
        locatorType: "css",
        locatorValue: selector,
        locatorExpression: `page.locator('${escapeJsString(selector)}')`,
        score: 90,
        isPrimary: result.length === 0
      });
    }
    const src = element.getAttribute("src");
    if (src) {
      const selector = `${element.tagName.toLowerCase()}[src="${CSS.escape(src)}"]`;
      result.push({
        locatorType: "css",
        locatorValue: selector,
        locatorExpression: `page.locator('${escapeJsString(selector)}')`,
        score: 90,
        isPrimary: result.length === 0
      });
    }
    const value = elementValue(element);
    if (value && value !== "***" && value.length <= 120) {
      const selector = `${element.tagName.toLowerCase()}[value="${CSS.escape(value)}"]`;
      result.push({
        locatorType: "css",
        locatorValue: selector,
        locatorExpression: `page.locator('${escapeJsString(selector)}')`,
        score: 88,
        isPrimary: result.length === 0
      });
    }
    const role = roleOf(element);
    const name = accessibleName(element);
    if (role && name) {
      result.push({
        locatorType: "role",
        locatorValue: JSON.stringify({ role, name }),
        locatorExpression: `page.getByRole('${escapeJsString(role)}', { name: '${escapeJsString(name)}' })`,
        score: role === "textbox" ? 70 : 85,
        isPrimary: result.length === 0
      });
    }
    const text = accessibleName(element);
    const canUseText = !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement);
    if (canUseText && text && text.length <= 80) {
      result.push({
        locatorType: "text",
        locatorValue: text,
        locatorExpression: `page.getByText('${escapeJsString(text)}')`,
        score: 60,
        isPrimary: result.length === 0
      });
    }
    const xpath = relativeXPath(element);
    result.push({
      locatorType: "relativeXPath",
      locatorValue: xpath,
      locatorExpression: `page.locator('xpath=${escapeJsString(xpath)}')`,
      score: 58,
      isPrimary: result.length === 0
    });
    const css = compactCssSelector(element);
    result.push({
      locatorType: "compactCss",
      locatorValue: css,
      locatorExpression: `page.locator('${escapeJsString(css)}')`,
      score: 62,
      isPrimary: result.length === 0
    });
    return result;
  }

  function actionOf(eventType: string, element: Element): string {
    if (eventType === "click") {
      return "click";
    }
    if (element instanceof HTMLSelectElement) {
      return "select";
    }
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      return element.checked ? "check" : "uncheck";
    }
    if (isContentEditableElement(element)) {
      return "fill";
    }
    return "fill";
  }

  function maskValue(element: Element): string | undefined {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.type === "password") {
        return "***";
      }
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      return element.value;
    }
    if (isContentEditableElement(element)) {
      return compactText(element.textContent, 1000) || "";
    }
    return undefined;
  }

  let order = 0;
  function emit(eventType: string, event: Event) {
    try {
      const target = captureTarget(event);
      if (!target) {
        return;
      }
      order += 1;
      window.__testPlatformCapture?.({
        eventOrder: order,
        eventType,
        action: actionOf(eventType, target),
        url: window.location.href,
        elementSnapshot: snapshot(target),
        locators: locators(target),
        inputValueMasked: maskValue(target),
        eventTime: new Date().toISOString()
      });
    } catch (error) {
      console.error("capture failed", error);
    }
  }

  document.addEventListener("click", (event) => emit("click", event), true);
  document.addEventListener("change", (event) => emit("change", event), true);
  document.addEventListener(
    "input",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        emit("input", event);
      }
    },
    true
  );
}

export async function startRecorder(options: RecorderOptions): Promise<RecorderHandle> {
  const browser = await launchBrowser(options);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true
  });
  let uploadChain = Promise.resolve();
  let finished = false;
  let globalEventOrder = 0;
  const activePages = new Set<Page>();
  const preparedPages = new WeakSet<Page>();
  let resolveDone: () => void = () => undefined;
  let rejectDone: (error: unknown) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  await context.exposeFunction("__testPlatformCapture", async (event: CapturedEvent & { eventOrder: number }) => {
    globalEventOrder += 1;
    const orderedEvent = {
      ...event,
      eventOrder: globalEventOrder,
      elementSnapshot: {
        ...(event.elementSnapshot ?? {}),
        agentContext: {
          browser: options.browser,
          headless: options.headless,
          startUrl: options.startUrl,
          environmentId: options.environmentId ?? null
        }
      }
    };
    console.log(`Captured ${orderedEvent.eventOrder}: ${orderedEvent.eventType} ${orderedEvent.action ?? ""}`);
    uploadChain = uploadChain.then(() =>
      uploadRecordingEvent(options.apiBaseUrl, options.token, {
        sessionNo: options.sessionNo,
        ...orderedEvent
      }).catch((error) => {
        console.error("Upload capture event failed", error);
      })
    );
    await uploadChain;
  });
  await context.addInitScript(`const __name = (target, _value) => target; (${injectionScript.toString()})();`);

  const page = await context.newPage();

  async function finish(error?: unknown): Promise<void> {
    if (finished) {
      return;
    }
    finished = true;
    try {
      await uploadChain;
      if (browser.isConnected()) {
        await browser.close().catch(() => undefined);
      }
      if (error) {
        rejectDone(error);
      } else {
        resolveDone();
      }
    } catch (cleanupError) {
      rejectDone(cleanupError);
    }
  }

  async function preparePage(targetPage: Page): Promise<void> {
    if (preparedPages.has(targetPage)) {
      return;
    }
    preparedPages.add(targetPage);
    activePages.add(targetPage);
    targetPage.on("pageerror", (error) => console.error("Page error", error));
    targetPage.on("console", (message) => {
      if (message.type() === "error") {
        console.error("Page console error", message.text());
      }
    });
    await targetPage.evaluate(`const __name = (target, _value) => target; (${injectionScript.toString()})();`).catch(() => undefined);
    targetPage.on("close", () => {
      activePages.delete(targetPage);
      if (activePages.size === 0) {
        void finish();
      }
    });
  }

  context.on("page", (newPage) => {
    void preparePage(newPage).catch((error) => console.error("Prepare recording page failed", error));
  });
  browser.on("disconnected", () => {
    void finish();
  });

  await preparePage(page);
  await page.goto(options.startUrl, { waitUntil: "domcontentloaded" });

  if (options.autoDemo) {
    void runAutoDemo(page)
      .then(() => finish())
      .catch((error) => finish(error));
  } else {
    console.log("Recorder is running. Close the browser or stop it from the platform.");
  }

  return {
    stop: () => finish(),
    done
  };
}

export async function runRecorder(options: RecorderOptions): Promise<void> {
  const handle = await startRecorder(options);
  process.on("SIGINT", async () => {
    await handle.stop();
    process.exit(0);
  });
  await handle.done;
}

async function runAutoDemo(page: Page): Promise<void> {
  await page.getByTestId("demo-username").fill("admin");
  await page.getByTestId("demo-password").fill("demo-password");
  await page.getByTestId("demo-login-button").click();
  await page.getByTestId("demo-welcome").waitFor({ state: "visible" });
}
