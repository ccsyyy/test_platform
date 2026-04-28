import { Router } from "express";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { mysqlPool } from "../db/mysql.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { assertProjectAccess } from "../middleware/projectAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { buildLocator } from "../worker/locator.js";

export const elementsRouter = Router();

elementsRouter.use(requireAuth);

const locatorSchema = z.object({
  locatorType: z.string().min(1).max(64),
  locatorValue: z.string().min(1),
  locatorExpression: z.string().optional(),
  score: z.number().int().min(0).max(100).default(0),
  isPrimary: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  isVisible: z.boolean().default(false),
  isActionable: z.boolean().default(false),
  source: z.string().max(32).optional(),
  status: z.string().max(32).optional(),
  priority: z.number().int().min(0).max(999999).optional(),
  confidence: z.number().min(0).max(100).optional()
});

const editableLocatorSchema = locatorSchema.extend({
  id: z.number().int().positive().optional()
});

const elementSchema = z.object({
  projectId: z.number().int().positive(),
  pageId: z.number().int().positive().nullable().optional(),
  componentId: z.number().int().positive().nullable().optional(),
  elementName: z.string().min(1).max(200),
  validStatus: z.number().int().min(0).max(1).optional(),
  elementType: z.string().max(64).nullable().optional(),
  defaultAction: z.string().max(64).nullable().optional(),
  sourceUrl: z.string().url().max(1000).nullable().optional(),
  textContent: z.string().max(1000).nullable().optional(),
  tagName: z.string().max(64).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  locators: z.array(locatorSchema).min(1)
});

const updateElementSchema = z.object({
  pageId: z.number().int().positive().nullable().optional(),
  componentId: z.number().int().positive().nullable().optional(),
  elementName: z.string().min(1).max(200).optional(),
  validStatus: z.number().int().min(0).max(1).optional(),
  elementType: z.string().max(64).nullable().optional(),
  defaultAction: z.string().max(64).nullable().optional(),
  sourceUrl: z.string().url().max(1000).nullable().optional(),
  textContent: z.string().max(1000).nullable().optional(),
  tagName: z.string().max(64).nullable().optional(),
  primaryLocatorId: z.number().int().positive().optional(),
  primaryLocator: z
    .object({
      locatorType: z.string().min(1).max(64),
      locatorValue: z.string().min(1),
      locatorExpression: z.string().optional()
    })
    .optional(),
  locators: z.array(editableLocatorSchema).min(1).optional()
});

const updatePageSchema = z.object({
  pageName: z.string().min(1).max(200)
});

const updateComponentSchema = z.object({
  componentName: z.string().min(1).max(200)
});

const materializeComponentGroupSchema = z.object({
  projectId: z.number().int().positive(),
  pageId: z.number().int().positive().optional(),
  componentName: z.string().min(1).max(200)
});

const validateElementSchema = z.object({
  environmentId: z.number().int().positive().optional()
});

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

function parseRoleLocatorValue(locatorValue: string): { role: string; options: Record<string, string | number | boolean> } | null {
  try {
    const parsed = JSON.parse(locatorValue) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const role = typeof parsed.role === "string" ? parsed.role.trim() : "";
    if (!role) {
      return null;
    }
    const options: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "role" || value === null || value === undefined) {
        continue;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          options[key] = trimmed;
        }
        continue;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        options[key] = value;
      }
    }
    return { role, options };
  } catch {
    return null;
  }
}

function buildLocatorExpression(locatorType: string, locatorValue: string): string | null {
  const type = canonicalLocatorType(locatorType);
  const value = String(locatorValue || "").trim();
  if (!type || !value) {
    return null;
  }
  if (type === "testid" || type === "get_by_test_id" || type === "getbytestid") {
    return `page.getByTestId(${JSON.stringify(value)})`;
  }
  if (type === "role" || type === "get_by_role" || type === "getbyrole") {
    const roleLocator = parseRoleLocatorValue(value);
    if (roleLocator?.role) {
      return Object.keys(roleLocator.options).length
        ? `page.getByRole(${JSON.stringify(roleLocator.role)}, ${JSON.stringify(roleLocator.options)})`
        : `page.getByRole(${JSON.stringify(roleLocator.role)})`;
    }
    return `page.getByRole(${JSON.stringify(value)})`;
  }
  if (type === "label") {
    return `page.getByLabel(${JSON.stringify(value)})`;
  }
  if (type === "placeholder") {
    return `page.getByPlaceholder(${JSON.stringify(value)})`;
  }
  if (type === "text" || type === "get_by_text" || type === "getbytext") {
    return `page.getByText(${JSON.stringify(value)})`;
  }
  if (type === "xpath" || type === "relativexpath") {
    return `page.locator(${JSON.stringify(`xpath=${value}`)})`;
  }
  return `page.locator(${JSON.stringify(value)})`;
}

function dedupeLocatorRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const deduped: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const locatorType = String(row.locatorType ?? "").trim();
    const locatorValue = String(row.locatorValue ?? "").trim();
    if (!locatorType || !locatorValue) {
      continue;
    }
    const key = `${canonicalLocatorType(locatorType)}::${locatorValue}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...row,
      locatorType,
      locatorValue,
      locatorExpression: buildLocatorExpression(locatorType, locatorValue)
    });
  }
  return deduped;
}

type EditableLocatorInput = z.infer<typeof editableLocatorSchema>;

function normalizeEditableLocators(
  rows: EditableLocatorInput[],
  primaryLocatorId?: number | null
): EditableLocatorInput[] {
  const seen = new Set<string>();
  const deduped: EditableLocatorInput[] = [];
  for (const row of rows) {
    const locatorType = String(row.locatorType ?? "").trim();
    const locatorValue = String(row.locatorValue ?? "").trim();
    if (!locatorType || !locatorValue) {
      continue;
    }
    const key = `${canonicalLocatorType(locatorType)}::${locatorValue}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...row,
      locatorType,
      locatorValue,
      locatorExpression: buildLocatorExpression(locatorType, locatorValue) ?? undefined
    });
  }
  if (!deduped.length) {
    throw new HttpError(400, "At least one locator is required");
  }
  let primaryMatched = false;
  const normalized = deduped.map((row, index) => {
    const isPrimaryById = primaryLocatorId ? Number(row.id) === Number(primaryLocatorId) : false;
    const isPrimary = isPrimaryById || Boolean(row.isPrimary);
    if (isPrimary && !primaryMatched) {
      primaryMatched = true;
      return {
        ...row,
        isPrimary: true
      };
    }
    return {
      ...row,
      isPrimary: false
    };
  });
  if (!primaryMatched) {
    normalized[0] = {
      ...normalized[0],
      isPrimary: true
    };
  }
  return normalized;
}

function hasField<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveValidationUrl(input: {
  baseUrl?: string | null;
  sourceUrl?: string | null;
  urlPattern?: string | null;
}): string | null {
  const sourceUrl = String(input.sourceUrl || "").trim();
  const urlPattern = String(input.urlPattern || "").trim();
  const baseUrl = String(input.baseUrl || "").trim();
  if (isHttpUrl(sourceUrl)) {
    return sourceUrl;
  }
  if (isHttpUrl(urlPattern)) {
    return urlPattern;
  }
  if (baseUrl && sourceUrl) {
    try {
      return new URL(sourceUrl, baseUrl).toString();
    } catch {
      return null;
    }
  }
  if (baseUrl && urlPattern) {
    try {
      return new URL(urlPattern, baseUrl).toString();
    } catch {
      return null;
    }
  }
  return baseUrl || null;
}

function validationBrowserExecutableCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    localAppData ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : "",
    localAppData ? path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

async function launchValidationBrowser() {
  const baseOptions = { headless: true as const };
  try {
    return await chromium.launch(baseOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const browserMissing = /Executable doesn't exist|download new browsers|Failed to launch browser/i.test(message);
    if (!browserMissing) {
      throw error;
    }

    for (const channel of ["msedge", "chrome"] as const) {
      try {
        return await chromium.launch({ ...baseOptions, channel });
      } catch {
        // continue to the next fallback
      }
    }

    for (const executablePath of validationBrowserExecutableCandidates()) {
      if (!existsSync(executablePath)) {
        continue;
      }
      try {
        return await chromium.launch({ ...baseOptions, executablePath });
      } catch {
        // continue to the next fallback
      }
    }

    throw new HttpError(
      500,
      "No Chromium browser is available for element validation. Install it with `npx playwright install chromium` or configure `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`."
    );
  }
}

async function upsertElementLocators(input: {
  connection: Awaited<ReturnType<typeof mysqlPool.getConnection>>;
  elementId: number;
  locators: EditableLocatorInput[];
}): Promise<number> {
  const [existingRows] = await input.connection.query(
    `
    SELECT id
    FROM tp_element_locator
    WHERE element_id = ?
    `,
    [input.elementId]
  );
  const existingIds = new Set((existingRows as Array<{ id: number }>).map((row) => Number(row.id)));
  const keptIds = new Set<number>();
  let primaryLocatorId = 0;

  for (let index = 0; index < input.locators.length; index += 1) {
    const locator = input.locators[index];
    const rowId = locator.id ? Number(locator.id) : 0;
    const payload = [
      locator.locatorType,
      locator.locatorValue,
      locator.locatorExpression ?? null,
      typeof locator.score === "number" ? locator.score : 0,
      locator.isPrimary ? 1 : 0,
      locator.isUnique ? 1 : 0,
      locator.isVisible ? 1 : 0,
      locator.isActionable ? 1 : 0,
      locator.source ?? "manual",
      locator.status ?? "active",
      locator.priority ?? index + 1,
      locator.confidence ?? locator.score ?? 0
    ];

    if (rowId && existingIds.has(rowId)) {
      await input.connection.query(
        `
        UPDATE tp_element_locator
        SET locator_type = ?, locator_value = ?, locator_expression = ?, score = ?,
          is_primary = ?, is_unique = ?, is_visible = ?, is_actionable = ?,
          source = ?, status = ?, priority = ?, confidence = ?
        WHERE id = ? AND element_id = ?
        `,
        [...payload, rowId, input.elementId]
      );
      keptIds.add(rowId);
      if (locator.isPrimary) {
        primaryLocatorId = rowId;
      }
      continue;
    }

    const [insertResult] = await input.connection.query(
      `
      INSERT INTO tp_element_locator (
        element_id, locator_type, locator_value, locator_expression,
        score, is_primary, is_unique, is_visible, is_actionable,
        source, status, priority, confidence
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [input.elementId, ...payload]
    );
    const insertId = Number((insertResult as { insertId: number }).insertId);
    keptIds.add(insertId);
    if (locator.isPrimary) {
      primaryLocatorId = insertId;
    }
  }

  for (const existingId of existingIds) {
    if (!keptIds.has(existingId)) {
      await input.connection.query("DELETE FROM tp_element_locator WHERE id = ? AND element_id = ?", [
        existingId,
        input.elementId
      ]);
    }
  }

  const fallbackPrimaryId = primaryLocatorId || Array.from(keptIds)[0] || 0;
  if (!fallbackPrimaryId) {
    throw new HttpError(400, "At least one locator is required");
  }
  await input.connection.query("UPDATE tp_element_locator SET is_primary = 0 WHERE element_id = ?", [input.elementId]);
  await input.connection.query("UPDATE tp_element_locator SET is_primary = 1 WHERE id = ? AND element_id = ?", [
    fallbackPrimaryId,
    input.elementId
  ]);
  await input.connection.query(
    "UPDATE tp_element SET primary_locator_id = ?, updated_at = NOW(3) WHERE id = ?",
    [fallbackPrimaryId, input.elementId]
  );
  return fallbackPrimaryId;
}

async function getElementProjectId(elementId: number) {
  const [rows] = await mysqlPool.query(
    "SELECT project_id AS projectId FROM tp_element WHERE id = ? AND status <> 0 LIMIT 1",
    [elementId]
  );
  return (rows as Array<{ projectId: number }>)[0]?.projectId ?? null;
}

async function getPageProjectId(pageId: number) {
  const [rows] = await mysqlPool.query("SELECT project_id AS projectId FROM tp_page WHERE id = ? LIMIT 1", [pageId]);
  return (rows as Array<{ projectId: number }>)[0]?.projectId ?? null;
}

async function getComponentProjectId(componentId: number) {
  const [rows] = await mysqlPool.query("SELECT project_id AS projectId FROM tp_component WHERE id = ? LIMIT 1", [
    componentId
  ]);
  return (rows as Array<{ projectId: number }>)[0]?.projectId ?? null;
}

async function countElementReferences(whereSql: string, params: unknown[]) {
  const [rows] = await mysqlPool.query(
    `
    SELECT COUNT(DISTINCT s.id) AS total
    FROM tp_case_step s
    JOIN tp_test_case tc ON tc.id = s.case_id AND tc.status <> 0
    JOIN tp_element e ON e.id = s.element_id
    WHERE s.status = 1 AND e.status <> 0 AND ${whereSql}
    `,
    params
  );
  return Number((rows as Array<{ total: number }>)[0]?.total || 0);
}

async function validateElementLocators(input: {
  elementId: number;
  projectId: number;
  environmentId?: number | null;
}) {
  const [validationRows] = await mysqlPool.query(
    `
    SELECT e.primary_locator_id AS primaryLocatorId, e.source_url AS sourceUrl,
      p.url_pattern AS urlPattern
    FROM tp_element e
    LEFT JOIN tp_page p ON p.id = e.page_id
    WHERE e.id = ?
    LIMIT 1
    `,
    [input.elementId]
  );
  const validationTarget = (validationRows as Array<{
    primaryLocatorId: number | null;
    sourceUrl: string | null;
    urlPattern: string | null;
  }>)[0];
  if (!validationTarget) {
    throw new HttpError(404, "Element not found");
  }

  const [validationLocatorRows] = await mysqlPool.query(
    `
    SELECT id, locator_type AS locatorType, locator_value AS locatorValue
    FROM tp_element_locator
    WHERE element_id = ?
    ORDER BY is_primary DESC, COALESCE(priority, 999999) ASC, id ASC
    `,
    [input.elementId]
  );
  const validationLocators = validationLocatorRows as Array<{
    id: number;
    locatorType: string;
    locatorValue: string;
  }>;
  if (!validationLocators.length) {
    throw new HttpError(400, "Element does not have any locator");
  }

  let validationBaseUrl = "";
  if (input.environmentId) {
    const [environmentRows] = await mysqlPool.query(
      "SELECT base_url AS baseUrl FROM tp_environment WHERE id = ? AND project_id = ? LIMIT 1",
      [input.environmentId, input.projectId]
    );
    validationBaseUrl = String((environmentRows as Array<{ baseUrl: string | null }>)[0]?.baseUrl || "");
  }
  if (!validationBaseUrl) {
    const [fallbackEnvironmentRows] = await mysqlPool.query(
      "SELECT base_url AS baseUrl FROM tp_environment WHERE project_id = ? ORDER BY id ASC LIMIT 1",
      [input.projectId]
    );
    validationBaseUrl = String((fallbackEnvironmentRows as Array<{ baseUrl: string | null }>)[0]?.baseUrl || "");
  }

  const validationUrl = resolveValidationUrl({
    baseUrl: validationBaseUrl,
    sourceUrl: validationTarget.sourceUrl,
    urlPattern: validationTarget.urlPattern
  });
  if (!validationUrl) {
    throw new HttpError(400, "Unable to resolve validation URL for this element");
  }

  const browser = await launchValidationBrowser();
  let primaryError: string | null = "Primary locator validation was not executed";
  let primaryValid = false;
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(validationUrl, { waitUntil: "domcontentloaded" });

    for (const locator of validationLocators) {
      let count = 0;
      let isVisible = false;
      let isActionable = false;
      let errorMessage: string | null = null;

      try {
        const candidate = buildLocator(page, locator.locatorType, locator.locatorValue);
        count = await candidate.count();
        if (!count) {
          errorMessage = "Locator did not match any element";
        } else if (count > 1) {
          errorMessage = `Locator matched ${count} elements`;
        } else {
          const first = candidate.first();
          isVisible = await first.isVisible().catch(() => false);
          isActionable = await first
            .evaluate((node) => {
              if (!(node instanceof HTMLElement)) {
                return false;
              }
              const style = window.getComputedStyle(node);
              const disabled =
                "disabled" in node
                  ? Boolean(
                      (node as HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement).disabled
                    )
                  : node.hasAttribute("disabled");
              return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none" && !disabled;
            })
            .catch(() => false);
          if (!isVisible) {
            errorMessage = "Matched element is not visible";
          }
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      const isSuccess = !errorMessage;
      await mysqlPool.query(
        `
        UPDATE tp_element_locator
        SET is_unique = ?, is_visible = ?, is_actionable = ?,
          last_checked_at = NOW(3),
          last_success_at = CASE WHEN ? = 1 THEN NOW(3) ELSE last_success_at END,
          last_failed_at = CASE WHEN ? = 1 THEN NOW(3) ELSE last_failed_at END,
          success_count = COALESCE(success_count, 0) + ?,
          failed_count = COALESCE(failed_count, 0) + ?,
          last_error = ?, status = ?
        WHERE id = ? AND element_id = ?
        `,
        [
          count === 1 ? 1 : 0,
          isVisible ? 1 : 0,
          isActionable ? 1 : 0,
          isSuccess ? 1 : 0,
          isSuccess ? 0 : 1,
          isSuccess ? 1 : 0,
          isSuccess ? 0 : 1,
          errorMessage,
          isSuccess ? "verified" : "failed",
          locator.id,
          input.elementId
        ]
      );

      if (
        Number(validationTarget.primaryLocatorId || 0) === Number(locator.id) ||
        (!validationTarget.primaryLocatorId && !primaryValid)
      ) {
        primaryValid = isSuccess;
        primaryError = errorMessage;
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  await mysqlPool.query(
    `
    UPDATE tp_element
    SET valid_status = ?, last_validated_at = NOW(3), last_error = ?, updated_at = NOW(3)
    WHERE id = ?
    `,
    [primaryValid ? 1 : 0, primaryValid ? null : primaryError, input.elementId]
  );

  return {
    elementId: input.elementId,
    validStatus: primaryValid ? 1 : 0,
    lastError: primaryValid ? null : primaryError,
    checkedUrl: validationUrl
  };
}

elementsRouter.get(
  "/elements/tree",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.query.projectId);
    await assertProjectAccess(projectId, request.user!);
    const [rows] = await mysqlPool.query(
      `
      SELECT p.id AS pageId, COALESCE(p.page_name, '未分组页面') AS pageName,
        c.id AS componentId, COALESCE(c.component_name, '未分组组件') AS componentName,
        COUNT(e.id) AS elementCount
      FROM tp_element e
      LEFT JOIN tp_page p ON p.id = e.page_id
      LEFT JOIN tp_component c ON c.id = e.component_id
      WHERE e.project_id = ? AND e.status <> 0
      GROUP BY p.id, p.page_name, c.id, c.component_name
      ORDER BY COALESCE(p.page_name, '未分组页面'), COALESCE(c.component_name, '未分组组件')
      `,
      [projectId]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

elementsRouter.patch(
  "/pages/:pageId",
  asyncHandler(async (request, response) => {
    const pageId = Number(request.params.pageId);
    const projectId = await getPageProjectId(pageId);
    if (!projectId) {
      throw new HttpError(404, "Page not found");
    }
    await assertProjectAccess(projectId, request.user!, "edit_elements");
    const body = updatePageSchema.parse(request.body);
    await mysqlPool.query("UPDATE tp_page SET page_name = ?, updated_at = NOW(3) WHERE id = ?", [body.pageName, pageId]);
    response.json({ code: 200, message: "success", data: { pageId } });
  })
);

elementsRouter.patch(
  "/components/:componentId",
  asyncHandler(async (request, response) => {
    const componentId = Number(request.params.componentId);
    const projectId = await getComponentProjectId(componentId);
    if (!projectId) {
      throw new HttpError(404, "Component not found");
    }
    await assertProjectAccess(projectId, request.user!, "edit_elements");
    const body = updateComponentSchema.parse(request.body);
    await mysqlPool.query("UPDATE tp_component SET component_name = ?, updated_at = NOW(3) WHERE id = ?", [
      body.componentName,
      componentId
    ]);
    response.json({ code: 200, message: "success", data: { componentId } });
  })
);

elementsRouter.delete(
  "/pages/:pageId",
  asyncHandler(async (request, response) => {
    const pageId = Number(request.params.pageId);
    const projectId = await getPageProjectId(pageId);
    if (!projectId) {
      throw new HttpError(404, "Page not found");
    }
    await assertProjectAccess(projectId, request.user!, "delete_elements");
    const referenceCount = await countElementReferences("e.page_id = ?", [pageId]);
    if (referenceCount > 0) {
      throw new HttpError(400, `Page elements are referenced by ${referenceCount} case steps. Remove those references first.`);
    }
    await mysqlPool.query(
      "UPDATE tp_element SET status = 0, updated_at = NOW(3) WHERE project_id = ? AND page_id = ? AND status <> 0",
      [projectId, pageId]
    );
    response.json({ code: 200, message: "success", data: { pageId } });
  })
);

elementsRouter.delete(
  "/components/:componentId",
  asyncHandler(async (request, response) => {
    const componentId = Number(request.params.componentId);
    const projectId = await getComponentProjectId(componentId);
    if (!projectId) {
      throw new HttpError(404, "Component not found");
    }
    await assertProjectAccess(projectId, request.user!, "delete_elements");
    const referenceCount = await countElementReferences("e.component_id = ?", [componentId]);
    if (referenceCount > 0) {
      throw new HttpError(400, `Component elements are referenced by ${referenceCount} case steps. Remove those references first.`);
    }
    await mysqlPool.query(
      "UPDATE tp_element SET status = 0, updated_at = NOW(3) WHERE project_id = ? AND component_id = ? AND status <> 0",
      [projectId, componentId]
    );
    response.json({ code: 200, message: "success", data: { componentId } });
  })
);

elementsRouter.post(
  "/components/materialize-group",
  asyncHandler(async (request, response) => {
    const body = materializeComponentGroupSchema.parse(request.body);
    await assertProjectAccess(body.projectId, request.user!, "edit_elements");
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();

      if (body.pageId) {
        const pageProjectId = await getPageProjectId(body.pageId);
        if (!pageProjectId || Number(pageProjectId) !== Number(body.projectId)) {
          throw new HttpError(400, "Page does not belong to the current project");
        }
      }

      const [elementRows] = await connection.query(
        `
        SELECT id
        FROM tp_element
        WHERE project_id = ?
          AND ((? IS NULL AND page_id IS NULL) OR page_id = ?)
          AND component_id IS NULL
          AND status <> 0
        LIMIT 500
        `,
        [body.projectId, body.pageId ?? null, body.pageId ?? null]
      );
      const targetElements = elementRows as Array<{ id: number }>;
      if (!targetElements.length) {
        throw new HttpError(400, "No elements available in the current group");
      }

      const [insertResult] = await connection.query(
        `
        INSERT INTO tp_component (project_id, page_id, component_name, created_by)
        VALUES (?, ?, ?, ?)
        `,
        [body.projectId, body.pageId ?? null, body.componentName, request.user!.id]
      );
      const componentId = Number((insertResult as { insertId: number }).insertId);

      await connection.query(
        `
        UPDATE tp_element
        SET component_id = ?, updated_at = NOW(3)
        WHERE project_id = ?
          AND ((? IS NULL AND page_id IS NULL) OR page_id = ?)
          AND component_id IS NULL
          AND status <> 0
        `,
        [componentId, body.projectId, body.pageId ?? null, body.pageId ?? null]
      );

      await connection.commit();
      response.json({
        code: 200,
        message: "success",
        data: { componentId, updatedCount: targetElements.length }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

elementsRouter.get(
  "/elements",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.query.projectId);
    await assertProjectAccess(projectId, request.user!);
    const keyword = typeof request.query.keyword === "string" ? request.query.keyword : "";
    const pageId = Number(request.query.pageId);
    const elementType = typeof request.query.elementType === "string" ? request.query.elementType : "";
    const validStatus =
      typeof request.query.validStatus === "string" && request.query.validStatus !== ""
        ? Number(request.query.validStatus)
        : -1;
    const [rows] = await mysqlPool.query(
      `
      SELECT e.id, e.project_id AS projectId, e.page_id AS pageId,
        e.component_id AS componentId, e.element_name AS elementName,
        e.element_type AS elementType, e.default_action AS defaultAction,
        e.valid_status AS validStatus, e.last_validated_at AS lastValidatedAt,
        e.last_error AS lastError, e.status, e.created_at AS createdAt,
        e.updated_at AS updatedAt, p.page_name AS pageName,
        c.component_name AS componentName, l.locator_type AS primaryLocatorType,
        l.locator_value AS primaryLocatorValue, l.score AS primaryLocatorScore,
        CASE WHEN e.source_url IS NULL THEN 'manual' ELSE 'recording' END AS sourceType,
        u.username AS createdByName
      FROM tp_element e
      LEFT JOIN tp_page p ON p.id = e.page_id
      LEFT JOIN tp_component c ON c.id = e.component_id
      LEFT JOIN tp_element_locator l ON l.id = e.primary_locator_id
      LEFT JOIN sys_user u ON u.id = e.created_by
      WHERE e.project_id = ? AND e.status <> 0
        AND (? = '' OR e.element_name LIKE CONCAT('%', ?, '%'))
        AND (? = 0 OR (? = -1 AND e.page_id IS NULL) OR e.page_id = ?)
        AND (? = '' OR e.element_type = ?)
        AND (? = -1 OR e.valid_status = ?)
      ORDER BY COALESCE(p.page_name, '未分组页面'), COALESCE(c.component_name, ''), e.id DESC
      LIMIT 200
      `,
      [
        projectId,
        keyword,
        keyword,
        Number.isFinite(pageId) ? pageId : 0,
        Number.isFinite(pageId) ? pageId : 0,
        Number.isFinite(pageId) ? pageId : 0,
        elementType,
        elementType,
        Number.isFinite(validStatus) ? validStatus : -1,
        Number.isFinite(validStatus) ? validStatus : -1
      ]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

elementsRouter.get(
  "/elements/:elementId",
  asyncHandler(async (request, response) => {
    const elementId = Number(request.params.elementId);
    const projectId = await getElementProjectId(elementId);
    if (!projectId) {
      throw new HttpError(404, "Element not found");
    }
    await assertProjectAccess(projectId, request.user!);

    const [elementRows] = await mysqlPool.query(
      `
      SELECT e.id, e.project_id AS projectId, e.page_id AS pageId,
        e.component_id AS componentId, e.element_name AS elementName,
        e.element_type AS elementType, e.default_action AS defaultAction,
        e.valid_status AS validStatus, e.last_validated_at AS lastValidatedAt,
        e.last_error AS lastError, e.status, e.source_url AS sourceUrl,
        e.created_at AS createdAt, e.updated_at AS updatedAt,
        p.page_name AS pageName, c.component_name AS componentName,
        e.primary_locator_id AS primaryLocatorId, u.username AS createdByName
      FROM tp_element e
      LEFT JOIN tp_page p ON p.id = e.page_id
      LEFT JOIN tp_component c ON c.id = e.component_id
      LEFT JOIN sys_user u ON u.id = e.created_by
      WHERE e.id = ?
      LIMIT 1
      `,
      [elementId]
    );
    const element = (elementRows as Array<Record<string, unknown>>)[0];
    const [locators] = await mysqlPool.query(
      `
      SELECT id, locator_type AS locatorType, locator_value AS locatorValue,
        locator_expression AS locatorExpression, score, is_primary AS isPrimary,
        is_unique AS isUnique, is_visible AS isVisible, is_actionable AS isActionable,
        last_checked_at AS lastCheckedAt, last_error AS lastError,
        source, status, priority, confidence,
        last_success_at AS lastSuccessAt, last_failed_at AS lastFailedAt,
        success_count AS successCount, failed_count AS failedCount
      FROM tp_element_locator
      WHERE element_id = ?
      ORDER BY is_primary DESC, COALESCE(priority, 999999) ASC, score DESC, id ASC
      `,
      [elementId]
    );
    const locatorRows = dedupeLocatorRows(locators as Array<Record<string, unknown>>);
    const [references] = await mysqlPool.query(
      `
      SELECT DISTINCT c.id, c.case_code AS caseCode, c.case_name AS caseName,
        c.priority, c.status
      FROM tp_case_step s
      JOIN tp_test_case c ON c.id = s.case_id
      WHERE s.element_id = ? AND s.status = 1 AND c.status <> 0
      ORDER BY c.id DESC
      LIMIT 50
      `,
      [elementId]
    );

    response.json({
      code: 200,
      message: "success",
      data: {
        ...element,
        locators: locatorRows,
        references
      }
    });
  })
);

elementsRouter.patch(
  "/elements/:elementId",
  asyncHandler(async (request, response) => {
    const elementId = Number(request.params.elementId);
    const projectId = await getElementProjectId(elementId);
    if (!projectId) {
      throw new HttpError(404, "Element not found");
    }
    await assertProjectAccess(projectId, request.user!, "edit_elements");
    const body = updateElementSchema.parse(request.body);
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `
        UPDATE tp_element
        SET element_name = COALESCE(?, element_name),
          page_id = CASE WHEN ? = 1 THEN ? ELSE page_id END,
          component_id = CASE WHEN ? = 1 THEN ? ELSE component_id END,
          valid_status = CASE WHEN ? = 1 THEN ? ELSE valid_status END,
          element_type = CASE WHEN ? = 1 THEN ? ELSE element_type END,
          default_action = CASE WHEN ? = 1 THEN ? ELSE default_action END,
          source_url = CASE WHEN ? = 1 THEN ? ELSE source_url END,
          text_content = CASE WHEN ? = 1 THEN ? ELSE text_content END,
          tag_name = CASE WHEN ? = 1 THEN ? ELSE tag_name END,
          updated_at = NOW(3)
        WHERE id = ?
        `,
        [
          body.elementName ?? null,
          hasField(body, "pageId") ? 1 : 0,
          body.pageId ?? null,
          hasField(body, "componentId") ? 1 : 0,
          body.componentId ?? null,
          hasField(body, "validStatus") ? 1 : 0,
          body.validStatus ?? 0,
          hasField(body, "elementType") ? 1 : 0,
          body.elementType ?? null,
          hasField(body, "defaultAction") ? 1 : 0,
          body.defaultAction ?? null,
          hasField(body, "sourceUrl") ? 1 : 0,
          body.sourceUrl ?? null,
          hasField(body, "textContent") ? 1 : 0,
          body.textContent ?? null,
          hasField(body, "tagName") ? 1 : 0,
          body.tagName ?? null,
          elementId
        ]
      );

      let primaryLocatorId = Number(body.primaryLocatorId || 0);
      const nextLocators = body.locators ? [...body.locators] : [];
      if (body.primaryLocator) {
        nextLocators.push({
          ...body.primaryLocator,
          score: 80,
          isPrimary: true,
          isUnique: false,
          isVisible: false,
          isActionable: false,
          source: "manual",
          status: "active",
          priority: 1,
          confidence: 80
        });
      }

      if (nextLocators.length) {
        const normalizedLocators = normalizeEditableLocators(nextLocators, primaryLocatorId || undefined);
        primaryLocatorId = await upsertElementLocators({
          connection,
          elementId,
          locators: normalizedLocators
        });
      } else if (primaryLocatorId) {
        await connection.query("UPDATE tp_element_locator SET is_primary = 0 WHERE element_id = ?", [elementId]);
        await connection.query("UPDATE tp_element_locator SET is_primary = 1 WHERE id = ? AND element_id = ?", [
          primaryLocatorId,
          elementId
        ]);
        await connection.query(
          "UPDATE tp_element SET primary_locator_id = ?, updated_at = NOW(3) WHERE id = ?",
          [primaryLocatorId, elementId]
        );
      }

      await connection.commit();
      response.json({ code: 200, message: "success", data: { elementId } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

elementsRouter.post(
  "/elements/:elementId/validate",
  asyncHandler(async (request, response) => {
    const elementId = Number(request.params.elementId);
    const projectId = await getElementProjectId(elementId);
    if (!projectId) {
      throw new HttpError(404, "Element not found");
    }
    await assertProjectAccess(projectId, request.user!, "edit_elements");
    const body = validateElementSchema.parse(request.body ?? {});
    const result = await validateElementLocators({
      elementId,
      projectId,
      environmentId: body.environmentId
    });
    response.json({ code: 200, message: "success", data: result });
  })
);

elementsRouter.delete(
  "/elements/:elementId",
  asyncHandler(async (request, response) => {
    const elementId = Number(request.params.elementId);
    const projectId = await getElementProjectId(elementId);
    if (!projectId) {
      throw new HttpError(404, "Element not found");
    }
    await assertProjectAccess(projectId, request.user!, "delete_elements");
    const referenceCount = await countElementReferences("e.id = ?", [elementId]);
    if (referenceCount > 0) {
      throw new HttpError(400, `Element is referenced by ${referenceCount} case steps. Remove those references first.`);
    }
    await mysqlPool.query("UPDATE tp_element SET status = 0, updated_at = NOW(3) WHERE id = ?", [elementId]);
    response.json({ code: 200, message: "success", data: { elementId } });
  })
);

elementsRouter.post(
  "/elements",
  asyncHandler(async (request, response) => {
    const body = elementSchema.parse(request.body);
    await assertProjectAccess(body.projectId, request.user!, "edit_elements");
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      const [elementResult] = await connection.query(
        `
        INSERT INTO tp_element (
          project_id, page_id, component_id, element_name, element_type,
          default_action, source_url, text_content, tag_name, attributes_json, valid_status, created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)
        `,
        [
          body.projectId,
          body.pageId ?? null,
          body.componentId ?? null,
          body.elementName,
          body.elementType ?? null,
          body.defaultAction ?? null,
          body.sourceUrl ?? null,
          body.textContent ?? null,
          body.tagName ?? null,
          JSON.stringify(body.attributes ?? {}),
          Number(body.validStatus) === 1 ? 1 : 0,
          request.user?.id ?? null
        ]
      );
      const elementId = Number((elementResult as { insertId: number }).insertId);
      const primaryLocatorId = await upsertElementLocators({
        connection,
        elementId,
        locators: normalizeEditableLocators(body.locators)
      });

      await connection.commit();
      response.status(201).json({
        code: 201,
        message: "created",
        data: { id: elementId, primaryLocatorId }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);




