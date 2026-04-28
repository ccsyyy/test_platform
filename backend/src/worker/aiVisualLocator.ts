import type { Page } from "playwright";
import { getVisualAiConnectionConfig, type ProjectAiConfig } from "../services/ai.js";
import type { ResolvedLocatorMatch } from "./locator.js";
import type { CaseStepRecord } from "./types.js";

type DynamicImport = (specifier: string) => Promise<Record<string, unknown>>;
type MidsceneModelConfig = Record<string, string | number>;
type MidsceneAction = (prompt: string) => Promise<unknown>;
type MidsceneAgent = {
  aiAct?: MidsceneAction;
  aiAction?: MidsceneAction;
  action?: MidsceneAction;
  destroy?: () => Promise<void> | void;
};
type MidsceneModule = Record<string, unknown> & {
  PlaywrightAgent?: new (page: Page, opts?: Record<string, unknown>) => MidsceneAgent;
  overrideAIConfig?: (newConfig: Record<string, string>, extendMode?: boolean) => void;
};

const dynamicImport = new Function("specifier", "return import(specifier)") as DynamicImport;
const SUPPORTED_MIDSCENE_MODEL_FAMILIES = new Set([
  "qwen2.5-vl",
  "qwen3-vl",
  "qwen3.5",
  "qwen3.6",
  "doubao-vision",
  "doubao-seed",
  "gemini",
  "vlm-ui-tars",
  "vlm-ui-tars-doubao",
  "vlm-ui-tars-doubao-1.5",
  "glm-v",
  "auto-glm",
  "auto-glm-multilingual",
  "gpt-5"
]);

function stepParams(step: CaseStepRecord): Record<string, unknown> {
  const params = step.stepDsl.params;
  return params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
}

function stringParam(params: Record<string, unknown>, key: string): string {
  return typeof params[key] === "string" ? String(params[key]) : "";
}

function buildVisualPrompt(step: CaseStepRecord): string {
  const params = stepParams(step);
  const action = step.action.toLowerCase();
  const target = step.elementName || step.stepName || "target element";
  const area = [step.pageName, step.componentName].filter(Boolean).join(" / ");
  const prefix = area ? `In the ${area} area, ` : "On the current page, ";

  if (action === "fill") {
    return `${prefix}find the input for "${target}" and fill "${stringParam(params, "value")}".`;
  }
  if (action === "click") {
    return `${prefix}click "${target}".`;
  }
  if (action === "dblclick") {
    return `${prefix}double click "${target}".`;
  }
  if (action === "rightclick") {
    return `${prefix}right click "${target}".`;
  }
  if (action === "select") {
    return `${prefix}select "${stringParam(params, "value")}" from "${target}".`;
  }
  if (action === "check") {
    return `${prefix}check "${target}".`;
  }
  if (action === "uncheck") {
    return `${prefix}uncheck "${target}".`;
  }
  if (action === "press") {
    return `${prefix}focus "${target}" and press "${stringParam(params, "key")}".`;
  }
  return `${prefix}operate "${target}" with action "${step.action}".`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function normalizeMidsceneModelFamily(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const candidate = normalized.replace(/^midscene[:/]/, "").trim();
  return SUPPORTED_MIDSCENE_MODEL_FAMILIES.has(candidate) ? candidate : null;
}

function inferMidsceneModelFamily(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const explicit = normalizeMidsceneModelFamily(normalized);
  if (explicit) {
    return explicit;
  }
  if (/qwen2(?:\.5)?[-_ ]?vl|qwen[-_ ]?vl/.test(normalized)) {
    return "qwen2.5-vl";
  }
  if (/qwen3[-_ ]?vl/.test(normalized)) {
    return "qwen3-vl";
  }
  if (/qwen3\.6/.test(normalized)) {
    return "qwen3.6";
  }
  if (/qwen3\.5/.test(normalized)) {
    return "qwen3.5";
  }
  if (/doubao.*seed|seed.*doubao/.test(normalized)) {
    return "doubao-seed";
  }
  if (/doubao/.test(normalized)) {
    return "doubao-vision";
  }
  if (/gemini/.test(normalized)) {
    return "gemini";
  }
  if (/ui[-_ ]?tars.*doubao.*1\.5/.test(normalized)) {
    return "vlm-ui-tars-doubao-1.5";
  }
  if (/ui[-_ ]?tars.*doubao/.test(normalized)) {
    return "vlm-ui-tars-doubao";
  }
  if (/ui[-_ ]?tars/.test(normalized)) {
    return "vlm-ui-tars";
  }
  if (/auto[-_ ]?glm.*multi/.test(normalized)) {
    return "auto-glm-multilingual";
  }
  if (/auto[-_ ]?glm/.test(normalized)) {
    return "auto-glm";
  }
  if (/glm[-_ ]?v|glm[-_ ]?4(?:\.6)?v/.test(normalized)) {
    return "glm-v";
  }
  if (/gpt[-_ ]?5/.test(normalized)) {
    return "gpt-5";
  }
  return null;
}

function resolveMidsceneModelFamily(projectConfig: ProjectAiConfig): string | null {
  const explicitFamily = normalizeMidsceneModelFamily(projectConfig.aiVisualModelFamily || "");
  if (explicitFamily) {
    return explicitFamily;
  }
  const providerOverride = normalizeMidsceneModelFamily(projectConfig.aiVisualProvider || "");
  if (providerOverride) {
    return providerOverride;
  }
  return inferMidsceneModelFamily(getVisualAiConnectionConfig(projectConfig).model || "");
}

function buildMidsceneModelConfig(projectConfig: ProjectAiConfig): MidsceneModelConfig {
  const connection = getVisualAiConnectionConfig(projectConfig);
  if (!connection.model || !connection.baseUrl || !connection.apiKey) {
    throw new Error(
      "Midscene visual locator requires visual AI model, Base URL and API key in the project AI settings."
    );
  }
  const modelFamily = resolveMidsceneModelFamily(projectConfig);
  if (!modelFamily) {
    throw new Error(
      `Midscene model family could not be inferred from AI model "${connection.model}". ` +
        "Set the visual locator model family field to a supported Midscene model family such as " +
        "qwen3-vl, qwen3.5, doubao-seed, glm-v, gemini or gpt-5."
    );
  }
  const timeoutMs = Number(projectConfig.aiVisualTimeoutMs || connection.timeoutMs || 15000);
  return {
    MIDSCENE_MODEL_NAME: connection.model,
    MIDSCENE_MODEL_BASE_URL: connection.baseUrl,
    MIDSCENE_MODEL_API_KEY: connection.apiKey,
    MIDSCENE_MODEL_FAMILY: modelFamily,
    MIDSCENE_MODEL_TIMEOUT: String(timeoutMs),
    OPENAI_BASE_URL: connection.baseUrl,
    OPENAI_API_KEY: connection.apiKey
  };
}

function resolveAgentAction(agent: MidsceneAgent): MidsceneAction | null {
  if (isFunction(agent.aiAct)) {
    return agent.aiAct.bind(agent);
  }
  if (isFunction(agent.aiAction)) {
    return agent.aiAction.bind(agent);
  }
  if (isFunction(agent.action)) {
    return agent.action.bind(agent);
  }
  return null;
}

function createPlaywrightAgentAction(
  PlaywrightAgent: new (page: Page, opts?: Record<string, unknown>) => MidsceneAgent,
  page: Page,
  modelConfig: MidsceneModelConfig
): MidsceneAction {
  return async (prompt) => {
    const agent = new PlaywrightAgent(page, {
      forceSameTabNavigation: true,
      modelConfig
    });
    const action = resolveAgentAction(agent);
    if (!action) {
      await Promise.resolve(agent.destroy?.()).catch(() => undefined);
      throw new Error("Midscene PlaywrightAgent does not expose aiAct/aiAction/action.");
    }
    try {
      return await action(prompt);
    } finally {
      await Promise.resolve(agent.destroy?.()).catch(() => undefined);
    }
  };
}

async function loadMidsceneRuntime(
  page: Page,
  projectConfig: ProjectAiConfig
): Promise<{ action: (prompt: string) => Promise<unknown>; provider: string }> {
  const pageWithAi = page as Page & { aiAct?: MidsceneAction; aiAction?: MidsceneAction };
  if (isFunction(pageWithAi.aiAct)) {
    return {
      provider: "page.aiAct",
      action: (prompt) => pageWithAi.aiAct!(prompt)
    };
  }
  if (isFunction(pageWithAi.aiAction)) {
    return {
      provider: "page.aiAction",
      action: (prompt) => pageWithAi.aiAction!(prompt)
    };
  }
  const modelConfig = buildMidsceneModelConfig(projectConfig);

  const errors: string[] = [];
  for (const specifier of ["@midscene/web/playwright", "@midscene/web", "midscene"]) {
    try {
      const module = (await dynamicImport(specifier)) as MidsceneModule;

      if (isFunction(module.PlaywrightAgent)) {
        return {
          provider: specifier,
          action: createPlaywrightAgentAction(module.PlaywrightAgent, page, modelConfig)
        };
      }

      const directAction = isFunction(module.aiAct) ? module.aiAct : isFunction(module.aiAction) ? module.aiAction : null;
      if (directAction) {
        module.overrideAIConfig?.(
          Object.fromEntries(Object.entries(modelConfig).map(([key, value]) => [key, String(value)])),
          false
        );
        return {
          provider: specifier,
          action: (prompt) => (directAction as (page: Page, prompt: string) => Promise<unknown>)(page, prompt)
        };
      }

      const factory =
        module.PlaywrightAgent ||
        module.agentFromPage ||
        module.createAgent ||
        module.createMidsceneAgent ||
        module.default;
      if (isFunction(factory)) {
        let agent: unknown;
        try {
          agent = new (factory as unknown as new (page: Page, opts?: Record<string, unknown>) => unknown)(
            page,
            {
              forceSameTabNavigation: true,
              modelConfig
            }
          );
        } catch {
          agent = await (factory as (page: Page, opts?: Record<string, unknown>) => Promise<unknown> | unknown)(page, {
            forceSameTabNavigation: true,
            modelConfig
          });
        }
        const action = isObject(agent) ? resolveAgentAction(agent as MidsceneAgent) : null;
        if (action) {
          return {
            provider: specifier,
            action
          };
        }
      }
    } catch (error) {
      errors.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `Midscene.js runtime is not available. Install and configure @midscene/web or expose page.aiAction. ${errors.join("; ")}`
  );
}

async function settleAfterVisualAction(page: Page): Promise<Page> {
  const pages = page.context().pages().filter((candidate) => !candidate.isClosed());
  const activePage = pages[pages.length - 1] ?? page;
  await activePage.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => undefined);
  await activePage.waitForLoadState("load", { timeout: 4000 }).catch(() => undefined);
  await activePage.waitForTimeout(600).catch(() => undefined);
  return activePage;
}

export interface AiVisualRunResult {
  prompt: string;
  provider: string;
  page: Page;
  matchedLocator: ResolvedLocatorMatch;
}

export async function runAiVisualLocator(input: {
  page: Page;
  step: CaseStepRecord;
  projectConfig: ProjectAiConfig;
}): Promise<AiVisualRunResult> {
  const prompt = buildVisualPrompt(input.step);
  const runtime = await loadMidsceneRuntime(input.page, input.projectConfig);
  const timeoutMs = Number(getVisualAiConnectionConfig(input.projectConfig).timeoutMs || 15000);
  await Promise.race([
    runtime.action(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Midscene visual locator timed out")), timeoutMs))
  ]);
  const page = await settleAfterVisualAction(input.page);
  return {
    prompt,
    provider: runtime.provider,
    page,
    matchedLocator: {
      locatorType: "ai_visual",
      locatorValue: prompt,
      locatorExpression: null,
      source: "ai_visual",
      resolution: "fallback",
      candidateIndex: 1,
      candidateTotal: 1,
      confidence: 100,
      score: 100
    }
  };
}
