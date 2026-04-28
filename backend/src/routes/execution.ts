import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { mysqlPool } from "../db/mysql.js";
import { redis } from "../db/redis.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { assertProjectAccess, getProjectIdByJob } from "../middleware/projectAccess.js";
import { removeArtifactDirectoryForJob } from "../services/artifacts.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { parseJson } from "../utils/json.js";

export const executionRouter = Router();

executionRouter.use(requireAuth);

const jobSchema = z.object({
  projectId: z.number().int().positive(),
  environmentId: z.number().int().positive().optional(),
  browser: z.enum(["chromium", "chrome", "edge"]).default("chromium"),
  caseIds: z.array(z.number().int().positive()).min(1),
  config: z
    .object({
      headless: z.boolean().optional(),
      viewport: z
        .object({
          width: z.number().int().positive(),
          height: z.number().int().positive()
        })
        .optional(),
      retries: z.number().int().min(0).max(5).optional(),
      timeoutMs: z.number().int().min(1000).max(300000).optional(),
      screenshot: z.boolean().optional(),
      video: z.boolean().optional(),
      trace: z.boolean().optional()
    })
    .optional()
    .transform((value) => ({
      headless: value?.headless ?? true,
      viewport: value?.viewport,
      retries: value?.retries ?? 0,
      timeoutMs: value?.timeoutMs ?? 30000,
      screenshot: value?.screenshot ?? true,
      video: value?.video ?? true,
      trace: value?.trace ?? false
    }))
});

const rerunSchema = z.object({
  failedOnly: z.boolean().default(false)
});

type ExecutionConfig = z.infer<typeof jobSchema>["config"];

type QueuedJobInput = {
  projectId: number;
  environmentId?: number | null;
  browser: "chromium" | "chrome" | "edge";
  caseIds: number[];
  config: ExecutionConfig;
  createdBy?: number | null;
};

function normalizeExecutionErrorMessage(message: unknown): string {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    return "";
  }
  if (text === "������ʱ" || /^�{2,}.*ʱ$/.test(text)) {
    return "AI 请求超时";
  }
  return text;
}

async function queueExecutionJob(input: QueuedJobInput): Promise<string> {
  const jobNo = `job_${Date.now()}_${uuidv4().slice(0, 8)}`;
  const configJson = {
    ...input.config,
    caseIds: input.caseIds
  };
  await mysqlPool.query(
    `
    INSERT INTO tp_execution_job (
      job_no, project_id, environment_id, browser, status, total_cases,
      config_json, created_by, queued_at
    )
    VALUES (?, ?, ?, ?, 'queued', ?, CAST(? AS JSON), ?, NOW(3))
    `,
    [
      jobNo,
      input.projectId,
      input.environmentId ?? null,
      input.browser,
      input.caseIds.length,
      JSON.stringify(configJson),
      input.createdBy ?? null
    ]
  );

  const payload = {
    jobNo,
    projectId: input.projectId,
    environmentId: input.environmentId ?? null,
    browser: input.browser,
    caseIds: input.caseIds,
    config: input.config
  };
  try {
    await redis.lpush("test-platform:queue:execution", JSON.stringify(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mysqlPool.query(
      `
      UPDATE tp_execution_job
      SET status = 'failed', failed_cases = ?, error_message = ?,
        finished_at = NOW(3), updated_at = NOW(3)
      WHERE job_no = ?
      `,
      [input.caseIds.length, message, jobNo]
    );
    throw new HttpError(503, `Execution queue unavailable: ${message}`);
  }

  await redis
    .hmset(`test-platform:execution:${jobNo}:status`, {
      status: "queued",
      totalCases: String(input.caseIds.length),
      createdAt: new Date().toISOString()
    })
    .catch((error) => console.error(`Queue status cache update failed: ${jobNo}`, error));
  await redis
    .expire(`test-platform:execution:${jobNo}:status`, 60 * 60 * 24)
    .catch((error) => console.error(`Queue status cache ttl update failed: ${jobNo}`, error));

  return jobNo;
}

executionRouter.post(
  "/execution-jobs",
  asyncHandler(async (request, response) => {
    const body = jobSchema.parse(request.body);
    await assertProjectAccess(body.projectId, request.user!, "execute_cases");
    const jobNo = await queueExecutionJob({
      projectId: body.projectId,
      environmentId: body.environmentId ?? null,
      browser: body.browser,
      caseIds: body.caseIds,
      config: body.config,
      createdBy: request.user?.id ?? null
    });

    response.status(201).json({
      code: 201,
      message: "queued",
      data: { jobNo }
    });
  })
);

executionRouter.get(
  "/execution-jobs",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.query.projectId);
    await assertProjectAccess(projectId, request.user!);
    const [rows] = await mysqlPool.query(
      `
      SELECT j.id, j.job_no AS jobNo, j.project_id AS projectId, j.environment_id AS environmentId,
        e.env_name AS environmentName, j.browser, j.status,
        j.total_cases AS totalCases, j.passed_cases AS passedCases,
        j.failed_cases AS failedCases, j.skipped_cases AS skippedCases,
        j.error_message AS errorMessage, j.created_by AS createdBy,
        u.username AS createdByName, j.created_at AS createdAt, j.updated_at AS updatedAt,
        j.queued_at AS queuedAt, j.started_at AS startedAt, j.finished_at AS finishedAt,
        CASE
          WHEN j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
            THEN ROUND(TIMESTAMPDIFF(MICROSECOND, j.started_at, j.finished_at) / 1000)
          ELSE NULL
        END AS durationMs
      FROM tp_execution_job j
      LEFT JOIN tp_environment e ON e.id = j.environment_id
      LEFT JOIN sys_user u ON u.id = j.created_by
      WHERE (? = 0 OR j.project_id = ?)
      ORDER BY j.id DESC
      LIMIT 100
      `,
      [Number.isFinite(projectId) ? projectId : 0, Number.isFinite(projectId) ? projectId : 0]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

executionRouter.post(
  "/execution-jobs/:jobNo/rerun",
  asyncHandler(async (request, response) => {
    const body = rerunSchema.parse(request.body ?? {});
    const jobNo = String(request.params.jobNo);
    const projectId = await getProjectIdByJob(jobNo);
    if (!projectId) {
      throw new HttpError(404, "Execution job not found");
    }
    await assertProjectAccess(projectId, request.user!, "execute_cases");

    const [jobRows] = await mysqlPool.query(
      `
      SELECT id, project_id AS projectId, environment_id AS environmentId,
        browser, config_json AS configJson
      FROM tp_execution_job
      WHERE job_no = ?
      LIMIT 1
      `,
      [jobNo]
    );
    const sourceJob = (
      jobRows as Array<{
        id: number;
        projectId: number;
        environmentId: number | null;
        browser: "chromium" | "chrome" | "edge";
        configJson: unknown;
      }>
    )[0];
    if (!sourceJob) {
      throw new HttpError(404, "Execution job not found");
    }

    const config = parseJson<Record<string, unknown>>(sourceJob.configJson, {});
    const configuredCaseIds = Array.isArray(config.caseIds)
      ? config.caseIds.map((caseId) => Number(caseId)).filter((caseId) => Number.isInteger(caseId) && caseId > 0)
      : [];
    let caseIds = configuredCaseIds;

    if (body.failedOnly || caseIds.length === 0) {
      const [caseRows] = await mysqlPool.query(
        `
        SELECT case_id AS caseId
        FROM tp_execution_case_result
        WHERE job_id = ? ${body.failedOnly ? "AND status = 'failed'" : ""}
        ORDER BY id ASC
        `,
        [sourceJob.id]
      );
      caseIds = (caseRows as Array<{ caseId: number }>).map((row) => row.caseId);
    }

    if (!caseIds.length) {
      throw new HttpError(body.failedOnly ? 400 : 404, body.failedOnly ? "No failed cases available for rerun" : "No cases available for rerun");
    }

    const normalizedConfig = jobSchema.shape.config.parse(config);
    const rerunConfig = {
      ...normalizedConfig,
      screenshot: true,
      video: true,
      trace: false
    };
    const newJobNo = await queueExecutionJob({
      projectId: sourceJob.projectId,
      environmentId: sourceJob.environmentId,
      browser: sourceJob.browser,
      caseIds,
      config: rerunConfig,
      createdBy: request.user?.id ?? null
    });

    response.status(201).json({
      code: 201,
      message: "queued",
      data: { jobNo: newJobNo }
    });
  })
);

executionRouter.delete(
  "/execution-jobs/:jobNo",
  asyncHandler(async (request, response) => {
    const jobNo = String(request.params.jobNo);
    const projectId = await getProjectIdByJob(jobNo);
    if (!projectId) {
      throw new HttpError(404, "Execution job not found");
    }
    await assertProjectAccess(projectId, request.user!, "execute_cases");
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      const [jobRows] = await connection.query(
        `
        SELECT id
        FROM tp_execution_job
        WHERE job_no = ?
        LIMIT 1
        `,
        [jobNo]
      );
      const jobId = Number((jobRows as Array<{ id: number }>)[0]?.id || 0);
      if (!jobId) {
        throw new HttpError(404, "Execution job not found");
      }
      await connection.query("DELETE FROM tp_report WHERE job_id = ?", [jobId]);
      await connection.query("DELETE FROM tp_locator_heal_log WHERE job_id = ?", [jobId]);
      await connection.query("DELETE FROM tp_artifact WHERE job_id = ?", [jobId]);
      await connection.query(
        "DELETE FROM tp_execution_step_result WHERE case_result_id IN (SELECT id FROM tp_execution_case_result WHERE job_id = ?)",
        [jobId]
      );
      await connection.query("DELETE FROM tp_execution_case_result WHERE job_id = ?", [jobId]);
      await connection.query("DELETE FROM tp_execution_job WHERE id = ?", [jobId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await redis.del(`test-platform:execution:${jobNo}:status`);
    await removeArtifactDirectoryForJob(jobNo).catch((error) =>
      console.error(`Delete artifact directory failed: ${jobNo}`, error)
    );
    response.json({ code: 200, message: "success", data: { jobNo } });
  })
);

executionRouter.get(
  "/execution-jobs/:jobNo",
  asyncHandler(async (request, response) => {
    const jobNo = String(request.params.jobNo);
    const projectId = await getProjectIdByJob(jobNo);
    if (!projectId) {
      throw new HttpError(404, "Execution job not found");
    }
    await assertProjectAccess(projectId, request.user!);
    const [rows] = await mysqlPool.query(
      `
      SELECT j.id, j.job_no AS jobNo, j.project_id AS projectId, j.environment_id AS environmentId,
        e.env_name AS environmentName, j.browser, j.status,
        j.total_cases AS totalCases, j.passed_cases AS passedCases,
        j.failed_cases AS failedCases, j.skipped_cases AS skippedCases, j.error_message AS errorMessage,
        j.created_by AS createdBy, u.username AS createdByName,
        j.created_at AS createdAt, j.updated_at AS updatedAt, j.queued_at AS queuedAt,
        j.started_at AS startedAt, j.finished_at AS finishedAt,
        CASE
          WHEN j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
            THEN ROUND(TIMESTAMPDIFF(MICROSECOND, j.started_at, j.finished_at) / 1000)
          ELSE NULL
        END AS durationMs
      FROM tp_execution_job j
      LEFT JOIN tp_environment e ON e.id = j.environment_id
      LEFT JOIN sys_user u ON u.id = j.created_by
      WHERE j.job_no = ?
      LIMIT 1
      `,
      [jobNo]
    );
    const job = (rows as unknown[])[0] ?? null;
    if (!job) {
      response.json({ code: 200, message: "success", data: null });
      return;
    }

    const [caseResults] = await mysqlPool.query(
      `
      SELECT id, case_id AS caseId, case_name AS caseName, status, duration_ms AS durationMs,
        error_message AS errorMessage, started_at AS startedAt, finished_at AS finishedAt
      FROM tp_execution_case_result
      WHERE job_id = (SELECT id FROM tp_execution_job WHERE job_no = ?)
      ORDER BY id ASC
      `,
      [jobNo]
    );
    const [stepResults] = await mysqlPool.query(
      `
      SELECT r.id, r.case_result_id AS caseResultId, r.step_order AS stepOrder,
        r.action, r.status, r.duration_ms AS durationMs, r.error_message AS errorMessage,
        r.snapshot_json AS snapshot
      FROM tp_execution_step_result r
      JOIN tp_execution_case_result c ON c.id = r.case_result_id
      JOIN tp_execution_job j ON j.id = c.job_id
      WHERE j.job_no = ?
      ORDER BY r.case_result_id ASC, r.step_order ASC
      `,
      [jobNo]
    );
    const [artifacts] = await mysqlPool.query(
      `
      SELECT id, artifact_type AS artifactType, file_name AS fileName, content_type AS contentType,
        file_size AS fileSize, created_at AS createdAt
      FROM tp_artifact
      WHERE job_id = (SELECT id FROM tp_execution_job WHERE job_no = ?)
      ORDER BY id DESC
      `,
      [jobNo]
    );

    const mappedArtifacts = (artifacts as Array<Record<string, unknown>>).map((artifact) => ({
      ...artifact,
      artifactId: Number(artifact.id || 0),
      viewMode:
        String(artifact.artifactType || "") === "screenshot" || String(artifact.artifactType || "") === "video"
          ? "inline"
          : "download"
    }));
    const mappedCaseResults = (caseResults as Array<Record<string, unknown>>).map((item) => ({
      ...item,
      errorMessage: normalizeExecutionErrorMessage(item.errorMessage)
    }));
    const mappedStepResults = (stepResults as Array<Record<string, unknown>>).map((step) => {
      const snapshot = parseJson<Record<string, unknown> | null>(step.snapshot, null);
      const resolvedLocator =
        snapshot && typeof snapshot.resolvedLocator === "object" && snapshot.resolvedLocator
          ? (snapshot.resolvedLocator as Record<string, unknown>)
          : null;
      const locatorAttempts =
        snapshot && Array.isArray(snapshot.locatorAttempts)
          ? (snapshot.locatorAttempts as Array<Record<string, unknown>>)
          : [];
      const aiHeal =
        snapshot && typeof snapshot.aiHeal === "object" && snapshot.aiHeal
          ? (snapshot.aiHeal as Record<string, unknown>)
          : null;
      const aiCaptcha =
        snapshot && typeof snapshot.aiCaptcha === "object" && snapshot.aiCaptcha
          ? (snapshot.aiCaptcha as Record<string, unknown>)
          : null;
      const stepParams =
        snapshot && typeof snapshot.params === "object" && snapshot.params && !Array.isArray(snapshot.params)
          ? (snapshot.params as Record<string, unknown>)
          : {};
      return {
        ...step,
        errorMessage: normalizeExecutionErrorMessage(step.errorMessage),
        snapshot,
        stepName: snapshot && typeof snapshot.stepName === "string" ? snapshot.stepName : "",
        elementId: snapshot ? Number(snapshot.elementId || 0) || null : null,
        elementName: snapshot && typeof snapshot.elementName === "string" ? snapshot.elementName : "",
        params: stepParams,
        resolvedLocator: resolvedLocator
          ? {
              locatorType:
                typeof resolvedLocator.locatorType === "string" ? resolvedLocator.locatorType : "",
              locatorValue:
                typeof resolvedLocator.locatorValue === "string" ? resolvedLocator.locatorValue : "",
              locatorExpression:
                typeof resolvedLocator.locatorExpression === "string"
                  ? resolvedLocator.locatorExpression
                  : null,
              resolution:
                resolvedLocator.resolution === "fallback" ? "fallback" : "primary",
              candidateIndex: Number(resolvedLocator.candidateIndex || 0),
              candidateTotal: Number(resolvedLocator.candidateTotal || 0),
              source: typeof resolvedLocator.source === "string" ? resolvedLocator.source : ""
            }
          : null,
        locatorAttempts: locatorAttempts.map((attempt) => ({
          locatorType: typeof attempt.locatorType === "string" ? attempt.locatorType : "",
          locatorValue: typeof attempt.locatorValue === "string" ? attempt.locatorValue : "",
          source: typeof attempt.source === "string" ? attempt.source : "",
          success: Boolean(attempt.success),
          errorMessage: normalizeExecutionErrorMessage(attempt.errorMessage),
          candidateIndex: Number(attempt.candidateIndex || 0),
          candidateTotal: Number(attempt.candidateTotal || 0)
        })),
        aiHeal: aiHeal
          ? {
              used: Boolean(aiHeal.used),
              status: typeof aiHeal.status === "string" ? aiHeal.status : "",
              reason: normalizeExecutionErrorMessage(aiHeal.reason),
              confidence: Number(aiHeal.confidence || 0),
              selectedLocator:
                aiHeal.selectedLocator && typeof aiHeal.selectedLocator === "object"
                  ? aiHeal.selectedLocator
                  : null
            }
          : null,
        aiCaptcha: aiCaptcha
          ? {
              used: Boolean(aiCaptcha.used),
              text: typeof aiCaptcha.text === "string" ? aiCaptcha.text : "",
              reason: normalizeExecutionErrorMessage(aiCaptcha.reason),
              confidence: Number(aiCaptcha.confidence || 0),
              attempts: Array.isArray(aiCaptcha.attempts) ? aiCaptcha.attempts : []
            }
          : null
      };
    });

    response.json({
      code: 200,
      message: "success",
      data: {
        ...(job as Record<string, unknown>),
        errorMessage: normalizeExecutionErrorMessage((job as Record<string, unknown>).errorMessage),
        caseResults: mappedCaseResults,
        stepResults: mappedStepResults,
        artifacts: mappedArtifacts
      }
    });
  })
);
