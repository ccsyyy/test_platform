import { Router } from "express";
import { z } from "zod";
import { mysqlPool } from "../db/mysql.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { assertProjectAccess } from "../middleware/projectAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getCaptchaAiConnectionConfig,
  getHealingAiConnectionConfig,
  getProjectAiConfig,
  getVisualAiConnectionConfig,
  recognizeCaptchaWithAi,
  saveProjectAiConfig,
  testAiModel
} from "../services/ai.js";

export const aiRouter = Router();

aiRouter.use(requireAuth);

const aiConfigUpdateSchema = z
  .object({
    enableLocatorFallback: z.boolean().optional(),
    enableAiHealing: z.boolean().optional(),
    enableAiCaptcha: z.boolean().optional(),
    aiProvider: z.string().max(64).optional(),
    aiModel: z.string().max(128).optional(),
    aiBaseUrl: z.string().max(500).optional(),
    apiKey: z.string().max(4000).optional(),
    clearApiKey: z.boolean().optional(),
    aiTimeoutMs: z.number().int().positive().max(120000).optional(),
    maxAiAttempts: z.number().int().min(1).max(5).optional(),
    enableAiVisualLocator: z.boolean().optional(),
    aiVisualProvider: z.string().max(64).optional(),
    aiVisualModel: z.string().max(128).optional(),
    aiVisualBaseUrl: z.string().max(500).optional(),
    aiVisualModelFamily: z.string().max(64).optional(),
    aiVisualApiKey: z.string().max(4000).optional(),
    clearAiVisualApiKey: z.boolean().optional(),
    aiVisualTimeoutMs: z.number().int().positive().max(120000).optional(),
    aiVisualMaxAttempts: z.number().int().min(1).max(3).optional(),
    aiLocatorConfidenceThreshold: z.number().min(0).max(100).optional(),
    captchaConfidenceThreshold: z.number().min(0).max(100).optional(),
    captchaMaxAttempts: z.number().int().min(1).max(5).optional(),
    aiCaptchaProvider: z.string().max(64).optional(),
    aiCaptchaModel: z.string().max(128).optional(),
    aiCaptchaBaseUrl: z.string().max(500).optional(),
    aiCaptchaApiKey: z.string().max(4000).optional(),
    clearAiCaptchaApiKey: z.boolean().optional(),
    aiCaptchaTimeoutMs: z.number().int().positive().max(120000).optional(),
    autoPromoteHealedLocator: z.boolean().optional(),
    requireManualReview: z.boolean().optional(),
    allowAiOnProd: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Missing AI config fields");

const captchaRecognizeSchema = z.object({
  projectId: z.number().int().positive(),
  imageBase64: z.string().min(1),
  mimeType: z.string().default("image/png"),
  hint: z.string().max(500).optional(),
  pageUrl: z.string().max(1000).optional(),
  pageTitle: z.string().max(500).optional()
});

const aiModelTestSchema = z.object({
  feature: z.enum(["healing", "visual", "captcha"]).default("healing"),
  aiProvider: z.string().max(64).optional(),
  aiModel: z.string().max(128).optional(),
  aiBaseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(4000).optional(),
  aiTimeoutMs: z.number().int().positive().max(120000).optional(),
  aiVisualProvider: z.string().max(64).optional(),
  aiVisualModel: z.string().max(128).optional(),
  aiVisualBaseUrl: z.string().max(500).optional(),
  aiVisualModelFamily: z.string().max(64).optional(),
  aiVisualApiKey: z.string().max(4000).optional(),
  aiVisualTimeoutMs: z.number().int().positive().max(120000).optional(),
  aiCaptchaProvider: z.string().max(64).optional(),
  aiCaptchaModel: z.string().max(128).optional(),
  aiCaptchaBaseUrl: z.string().max(500).optional(),
  aiCaptchaApiKey: z.string().max(4000).optional(),
  aiCaptchaTimeoutMs: z.number().int().positive().max(120000).optional(),
  prompt: z.string().max(1000).optional()
});

const healLogListSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  status: z.string().max(32).optional(),
  keyword: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10)
});

async function getHealLogProjectId(logId: number): Promise<number | null> {
  const [rows] = await mysqlPool.query("SELECT project_id AS projectId FROM tp_locator_heal_log WHERE id = ? LIMIT 1", [logId]);
  return (rows as Array<{ projectId: number }>)[0]?.projectId ?? null;
}

aiRouter.get(
  "/projects/:projectId/ai-config",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    const aiConfig = await getProjectAiConfig(projectId);
    response.json({
      code: 200,
      message: "success",
      data: {
        ...aiConfig,
        apiKey: undefined,
        aiVisualApiKey: undefined,
        aiCaptchaApiKey: undefined
      }
    });
  })
);

aiRouter.patch(
  "/projects/:projectId/ai-config",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    const body = aiConfigUpdateSchema.parse(request.body);
    const aiConfig = await saveProjectAiConfig(projectId, body);
    response.json({
      code: 200,
      message: "success",
      data: {
        ...aiConfig,
        apiKey: undefined,
        aiVisualApiKey: undefined,
        aiCaptchaApiKey: undefined
      }
    });
  })
);

aiRouter.post(
  "/projects/:projectId/ai-config/test",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    const body = aiModelTestSchema.parse(request.body ?? {});
    const current = await getProjectAiConfig(projectId);
    const projectConfig = {
      ...current,
      aiProvider: body.aiProvider ?? current.aiProvider,
      aiModel: body.aiModel ?? current.aiModel,
      aiBaseUrl: body.aiBaseUrl ?? current.aiBaseUrl,
      aiTimeoutMs: body.aiTimeoutMs ?? current.aiTimeoutMs,
      apiKey: body.apiKey?.trim() || current.apiKey,
      hasApiKey: Boolean(body.apiKey?.trim() || current.hasApiKey),
      aiVisualProvider: body.aiVisualProvider ?? current.aiVisualProvider,
      aiVisualModel: body.aiVisualModel ?? current.aiVisualModel,
      aiVisualBaseUrl: body.aiVisualBaseUrl ?? current.aiVisualBaseUrl,
      aiVisualModelFamily: body.aiVisualModelFamily ?? current.aiVisualModelFamily,
      aiVisualTimeoutMs: body.aiVisualTimeoutMs ?? current.aiVisualTimeoutMs,
      aiVisualApiKey: body.aiVisualApiKey?.trim() || current.aiVisualApiKey,
      aiVisualHasApiKey: Boolean(body.aiVisualApiKey?.trim() || current.aiVisualHasApiKey),
      aiCaptchaProvider: body.aiCaptchaProvider ?? current.aiCaptchaProvider,
      aiCaptchaModel: body.aiCaptchaModel ?? current.aiCaptchaModel,
      aiCaptchaBaseUrl: body.aiCaptchaBaseUrl ?? current.aiCaptchaBaseUrl,
      aiCaptchaTimeoutMs: body.aiCaptchaTimeoutMs ?? current.aiCaptchaTimeoutMs,
      aiCaptchaApiKey: body.aiCaptchaApiKey?.trim() || current.aiCaptchaApiKey,
      aiCaptchaHasApiKey: Boolean(body.aiCaptchaApiKey?.trim() || current.aiCaptchaHasApiKey)
    };
    const connection =
      body.feature === "visual"
        ? getVisualAiConnectionConfig(projectConfig)
        : body.feature === "captcha"
          ? getCaptchaAiConnectionConfig(projectConfig)
          : getHealingAiConnectionConfig(projectConfig);
    const result = await testAiModel({
      connection,
      prompt: body.prompt
    });
    response.json({
      code: 200,
      message: "success",
      data: result
    });
  })
);

aiRouter.get(
  "/locator-heal-logs",
  asyncHandler(async (request, response) => {
    const query = healLogListSchema.parse(request.query);
    await assertProjectAccess(query.projectId, request.user!);
    const whereClauses = ["project_id = ?"];
    const params: Array<string | number> = [query.projectId];
    if (query.status?.trim()) {
      whereClauses.push("status = ?");
      params.push(query.status.trim());
    }
    if (query.keyword?.trim()) {
      whereClauses.push("(action LIKE CONCAT('%', ?, '%') OR page_title LIKE CONCAT('%', ?, '%') OR reason LIKE CONCAT('%', ?, '%'))");
      params.push(query.keyword.trim(), query.keyword.trim(), query.keyword.trim());
    }
    const [countRows] = await mysqlPool.query(
      `SELECT COUNT(*) AS total FROM tp_locator_heal_log WHERE ${whereClauses.join(" AND ")}`,
      params
    );
    const total = Number((countRows as Array<{ total: number }>)[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const offset = (page - 1) * query.pageSize;
    const [rows] = await mysqlPool.query(
      `
      SELECT id, project_id AS projectId, element_id AS elementId, case_id AS caseId, step_id AS stepId,
        job_id AS jobId, step_result_id AS stepResultId, page_url AS pageUrl, page_title AS pageTitle,
        action, old_locator_json AS oldLocator, attempted_locators_json AS attemptedLocators,
        ai_input_json AS aiInput, ai_candidates_json AS aiCandidates, selected_locator_json AS selectedLocator,
        confidence, reason, status, created_at AS createdAt, updated_at AS updatedAt
      FROM tp_locator_heal_log
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, query.pageSize, offset]
    );
    response.json({
      code: 200,
      message: "success",
      data: {
        items: rows,
        total,
        page,
        pageSize: query.pageSize,
        totalPages
      }
    });
  })
);

aiRouter.get(
  "/locator-heal-logs/:logId",
  asyncHandler(async (request, response) => {
    const logId = Number(request.params.logId);
    const projectId = await getHealLogProjectId(logId);
    if (!projectId) {
      throw new HttpError(404, "Heal log not found");
    }
    await assertProjectAccess(projectId, request.user!);
    const [rows] = await mysqlPool.query(
      `
      SELECT id, project_id AS projectId, element_id AS elementId, case_id AS caseId, step_id AS stepId,
        job_id AS jobId, step_result_id AS stepResultId, page_url AS pageUrl, page_title AS pageTitle,
        action, old_locator_json AS oldLocator, attempted_locators_json AS attemptedLocators,
        ai_input_json AS aiInput, ai_candidates_json AS aiCandidates, selected_locator_json AS selectedLocator,
        confidence, reason, status, created_at AS createdAt, updated_at AS updatedAt
      FROM tp_locator_heal_log
      WHERE id = ?
      LIMIT 1
      `,
      [logId]
    );
    response.json({ code: 200, message: "success", data: (rows as Array<Record<string, unknown>>)[0] || null });
  })
);

aiRouter.post(
  "/locator-heal-logs/:logId/apply",
  asyncHandler(async (request, response) => {
    const logId = Number(request.params.logId);
    const projectId = await getHealLogProjectId(logId);
    if (!projectId) {
      throw new HttpError(404, "Heal log not found");
    }
    await assertProjectAccess(projectId, request.user!, "edit_elements");
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `
        SELECT element_id AS elementId, selected_locator_json AS selectedLocator, confidence
        FROM tp_locator_heal_log
        WHERE id = ?
        LIMIT 1
        `,
        [logId]
      );
      const row = (rows as Array<Record<string, unknown>>)[0];
      const elementId = Number(row?.elementId || 0);
      if (!elementId) {
        throw new HttpError(400, "Heal log is not bound to any element");
      }
      const selectedLocator =
        row?.selectedLocator && typeof row.selectedLocator === "string"
          ? JSON.parse(String(row.selectedLocator))
          : row?.selectedLocator && typeof row.selectedLocator === "object"
            ? (row.selectedLocator as Record<string, unknown>)
            : null;
      const locatorType = String(selectedLocator?.locatorType || "").trim();
      const locatorValue = String(selectedLocator?.locatorValue || "").trim();
      if (!locatorType || !locatorValue) {
        throw new HttpError(400, "Heal log does not have a valid locator");
      }
      const [existingRows] = await connection.query(
        `
        SELECT id
        FROM tp_element_locator
        WHERE element_id = ? AND locator_type = ? AND locator_value = ?
        LIMIT 1
        `,
        [elementId, locatorType, locatorValue]
      );
      const existingLocatorId = Number((existingRows as Array<{ id: number }>)[0]?.id || 0);
      if (existingLocatorId) {
        await connection.query(
          `
          UPDATE tp_element_locator
          SET locator_expression = COALESCE(?, locator_expression),
            source = 'healed',
            status = 'active',
            priority = LEAST(COALESCE(priority, 999999), 50),
            confidence = ?,
            updated_at = NOW(3)
          WHERE id = ?
          `,
          [
            typeof selectedLocator?.locatorExpression === "string" ? selectedLocator.locatorExpression : null,
            Number(row?.confidence || 0),
            existingLocatorId
          ]
        );
      } else {
        await connection.query(
          `
          INSERT INTO tp_element_locator (
            element_id, locator_type, locator_value, locator_expression, score, is_primary,
            is_unique, is_visible, is_actionable, source, status, priority, confidence
          )
          VALUES (?, ?, ?, ?, ?, 0, 1, 1, 1, 'healed', 'active', 50, ?)
          `,
          [
            elementId,
            locatorType,
            locatorValue,
            typeof selectedLocator?.locatorExpression === "string" ? selectedLocator.locatorExpression : null,
            Math.round(Number(row?.confidence || 0)),
            Number(row?.confidence || 0)
          ]
        );
      }
      await connection.query(
        "UPDATE tp_locator_heal_log SET status = 'applied', updated_at = NOW(3) WHERE id = ?",
        [logId]
      );
      await connection.commit();
      response.json({ code: 200, message: "success", data: { logId } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

aiRouter.post(
  "/locator-heal-logs/:logId/reject",
  asyncHandler(async (request, response) => {
    const logId = Number(request.params.logId);
    const projectId = await getHealLogProjectId(logId);
    if (!projectId) {
      throw new HttpError(404, "Heal log not found");
    }
    await assertProjectAccess(projectId, request.user!, "edit_elements");
    await mysqlPool.query("UPDATE tp_locator_heal_log SET status = 'rejected', updated_at = NOW(3) WHERE id = ?", [logId]);
    response.json({ code: 200, message: "success", data: { logId } });
  })
);

aiRouter.post(
  "/ai/captcha/recognize",
  asyncHandler(async (request, response) => {
    const body = captchaRecognizeSchema.parse(request.body);
    await assertProjectAccess(body.projectId, request.user!);
    const aiConfig = await getProjectAiConfig(body.projectId);
    if (!aiConfig.enableAiCaptcha) {
      throw new HttpError(400, "AI captcha is disabled for the current project");
    }
    const recognition = await recognizeCaptchaWithAi({
      projectConfig: aiConfig,
      imageDataUrl: `data:${body.mimeType};base64,${body.imageBase64}`,
      hint: body.hint,
      pageUrl: body.pageUrl,
      pageTitle: body.pageTitle
    });
    response.json({ code: 200, message: "success", data: recognition });
  })
);
