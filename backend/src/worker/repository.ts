import type { RowDataPacket } from "mysql2";
import { mysqlPool } from "../db/mysql.js";
import { parseJson } from "../utils/json.js";
import type { LocatorAttempt, ResolvedLocatorMatch } from "./locator.js";
import type { CaseStepRecord, ExecutionQueuePayload } from "./types.js";

const ERROR_TEXT_LIMIT = 6000;

function safeDbText(value: string | null | undefined, limit = ERROR_TEXT_LIMIT): string | null {
  if (!value) {
    return null;
  }
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit)}... [truncated]` : text;
}

export async function markJobRunning(jobNo: string): Promise<number> {
  await mysqlPool.query(
    "UPDATE tp_execution_job SET status = 'running', started_at = NOW(3), updated_at = NOW(3) WHERE job_no = ?",
    [jobNo]
  );
  const [rows] = await mysqlPool.query("SELECT id FROM tp_execution_job WHERE job_no = ? LIMIT 1", [
    jobNo
  ]);
  const job = (rows as Array<{ id: number }>)[0];
  if (!job) {
    throw new Error(`Execution job not found: ${jobNo}`);
  }
  return job.id;
}

export async function markJobFinished(
  jobId: number,
  status: "passed" | "failed",
  counts: { passed: number; failed: number; skipped: number },
  errorMessage?: string
): Promise<void> {
  await mysqlPool.query(
    `
    UPDATE tp_execution_job
    SET status = ?, passed_cases = ?, failed_cases = ?, skipped_cases = ?,
      error_message = ?, finished_at = NOW(3), updated_at = NOW(3)
    WHERE id = ?
    `,
    [status, counts.passed, counts.failed, counts.skipped, safeDbText(errorMessage), jobId]
  );
}

export async function markJobFailedByNo(jobNo: string, failedCases: number, errorMessage: string): Promise<void> {
  await mysqlPool.query(
    `
    UPDATE tp_execution_job
    SET status = 'failed', passed_cases = 0, failed_cases = ?,
      error_message = ?, finished_at = NOW(3), updated_at = NOW(3)
    WHERE job_no = ? AND status IN ('queued', 'running')
    `,
    [failedCases, safeDbText(errorMessage), jobNo]
  );
}

export async function getEnvironmentBaseUrl(environmentId: number | null): Promise<string | undefined> {
  if (!environmentId) {
    return undefined;
  }
  const [rows] = await mysqlPool.query("SELECT base_url AS baseUrl FROM tp_environment WHERE id = ?", [
    environmentId
  ]);
  return (rows as Array<{ baseUrl: string }>)[0]?.baseUrl;
}

export async function getEnvironmentMeta(
  environmentId: number | null
): Promise<{ id: number; envType: string | null; envName: string | null; baseUrl: string | null } | null> {
  if (!environmentId) {
    return null;
  }
  const [rows] = await mysqlPool.query(
    `
    SELECT id, env_type AS envType, env_name AS envName, base_url AS baseUrl
    FROM tp_environment
    WHERE id = ?
    LIMIT 1
    `,
    [environmentId]
  );
  return (
    (rows as Array<{ id: number; envType: string | null; envName: string | null; baseUrl: string | null }>)[0] ??
    null
  );
}

export async function getCaseRows(caseIds: number[]): Promise<Array<{ id: number; caseName: string }>> {
  if (caseIds.length === 0) {
    return [];
  }
  const [rows] = await mysqlPool.query(
    `
    SELECT id, case_name AS caseName
    FROM tp_test_case
    WHERE id IN (?) AND status = 1
    ORDER BY FIELD(id, ?)
    `,
    [caseIds, caseIds]
  );
  return rows as Array<{ id: number; caseName: string }>;
}

interface StepRow extends RowDataPacket {
  id: number;
  caseId: number;
  stepOrder: number;
  stepName: string | null;
  action: string;
  elementId: number | null;
  stepDsl: unknown;
  locatorSnapshot: unknown;
  locatorId: number | null;
  locatorType: string | null;
  locatorValue: string | null;
  locatorExpression: string | null;
  elementName: string | null;
  pageName: string | null;
  componentName: string | null;
  elementAttributes: unknown;
}

export async function getCaseSteps(caseId: number): Promise<CaseStepRecord[]> {
  const [rows] = await mysqlPool.query<StepRow[]>(
    `
    SELECT s.id, s.case_id AS caseId, s.step_order AS stepOrder, s.step_name AS stepName,
      s.action, s.element_id AS elementId, s.step_dsl_json AS stepDsl,
      s.locator_snapshot_json AS locatorSnapshot,
      l.id AS locatorId, l.locator_type AS locatorType, l.locator_value AS locatorValue,
      l.locator_expression AS locatorExpression,
      e.element_name AS elementName, p.page_name AS pageName,
      c.component_name AS componentName, e.attributes_json AS elementAttributes
    FROM tp_case_step s
    LEFT JOIN tp_element e ON e.id = s.element_id
    LEFT JOIN tp_page p ON p.id = e.page_id
    LEFT JOIN tp_component c ON c.id = e.component_id
    LEFT JOIN tp_element_locator l ON l.id = e.primary_locator_id
    WHERE s.case_id = ? AND s.status = 1
    ORDER BY s.step_order ASC
    `,
    [caseId]
  );
  const elementIds = Array.from(
    new Set(
      rows
        .map((row) => Number(row.elementId || 0))
        .filter((elementId) => Number.isInteger(elementId) && elementId > 0)
    )
  );

  const locatorMap = new Map<number, CaseStepRecord["locatorCandidates"]>();
  if (elementIds.length) {
    const [locatorRows] = await mysqlPool.query<
      Array<
        RowDataPacket & {
          id: number;
          elementId: number;
          locatorType: string;
          locatorValue: string;
          locatorExpression: string | null;
          score: number;
          isPrimary: number;
          source: string | null;
          status: string | null;
          priority: number | null;
          confidence: number | null;
          successCount: number | null;
          failedCount: number | null;
        }
      >
    >(
      `
      SELECT id, element_id AS elementId, locator_type AS locatorType,
        locator_value AS locatorValue, locator_expression AS locatorExpression,
        score, is_primary AS isPrimary, source, status, priority, confidence,
        success_count AS successCount, failed_count AS failedCount
      FROM tp_element_locator
      WHERE element_id IN (?)
      ORDER BY element_id ASC, is_primary DESC,
        CASE status WHEN 'active' THEN 0 WHEN 'invalid' THEN 1 ELSE 2 END ASC,
        COALESCE(priority, 999999) ASC, score DESC, id ASC
      `,
      [elementIds]
    );

    for (const row of locatorRows) {
      const list = locatorMap.get(Number(row.elementId)) ?? [];
      list.push({
        id: Number(row.id),
        locatorType: row.locatorType,
        locatorValue: row.locatorValue,
        locatorExpression: row.locatorExpression,
        score: Number(row.score || 0),
        isPrimary: Boolean(row.isPrimary),
        source: row.source ?? undefined,
        status: row.status ?? undefined,
        priority: row.priority ?? undefined,
        confidence: row.confidence ?? undefined,
        successCount: row.successCount ?? undefined,
        failedCount: row.failedCount ?? undefined
      });
      locatorMap.set(Number(row.elementId), list);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    caseId: row.caseId,
    stepOrder: row.stepOrder,
    stepName: row.stepName,
    action: row.action,
    elementId: row.elementId,
    stepDsl: parseJson<Record<string, unknown>>(row.stepDsl, {}),
    locatorSnapshot: parseJson<Record<string, unknown> | Array<Record<string, unknown>> | null>(row.locatorSnapshot, null),
    locatorId: row.locatorId,
    locatorType: row.locatorType,
    locatorValue: row.locatorValue,
    locatorExpression: row.locatorExpression,
    elementName: row.elementName,
    pageName: row.pageName,
    componentName: row.componentName,
    elementAttributes: parseJson<Record<string, unknown> | null>(row.elementAttributes, null),
    locatorCandidates: row.elementId ? locatorMap.get(Number(row.elementId)) ?? [] : []
  }));
}

export async function createCaseResult(jobId: number, caseId: number, caseName: string): Promise<number> {
  const [result] = await mysqlPool.query(
    `
    INSERT INTO tp_execution_case_result (job_id, case_id, case_name, status, started_at)
    VALUES (?, ?, ?, 'running', NOW(3))
    `,
    [jobId, caseId, caseName]
  );
  return Number((result as { insertId: number }).insertId);
}

export async function finishCaseResult(
  caseResultId: number,
  status: "passed" | "failed" | "skipped",
  durationMs: number,
  errorMessage?: string
): Promise<void> {
  await mysqlPool.query(
    `
    UPDATE tp_execution_case_result
    SET status = ?, duration_ms = ?, error_message = ?, finished_at = NOW(3)
    WHERE id = ?
    `,
    [status, durationMs, safeDbText(errorMessage), caseResultId]
  );
}

export async function createStepResult(input: {
  caseResultId: number;
  stepId: number;
  stepOrder: number;
  action: string;
  status: "passed" | "failed";
  durationMs: number;
  errorMessage?: string;
  snapshot?: Record<string, unknown>;
}): Promise<number> {
  const [result] = await mysqlPool.query(
    `
    INSERT INTO tp_execution_step_result (
      case_result_id, step_id, step_order, action, status, duration_ms,
      error_message, snapshot_json, started_at, finished_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW(3), NOW(3))
    `,
    [
      input.caseResultId,
      input.stepId,
      input.stepOrder,
      input.action,
      input.status,
      input.durationMs,
      safeDbText(input.errorMessage),
      JSON.stringify(input.snapshot ?? {})
    ]
  );
  return Number((result as { insertId: number }).insertId);
}

export async function createArtifact(input: {
  projectId: number;
  jobId: number;
  caseResultId?: number;
  stepResultId?: number;
  artifactType: string;
  storagePath: string;
  fileName?: string;
  contentType?: string;
  fileSize?: number;
}): Promise<number> {
  const [result] = await mysqlPool.query(
    `
    INSERT INTO tp_artifact (
      project_id, job_id, case_result_id, step_result_id, artifact_type,
      storage_type, storage_path, file_name, content_type, file_size
    )
    VALUES (?, ?, ?, ?, ?, 'local', ?, ?, ?, ?)
    `,
    [
      input.projectId,
      input.jobId,
      input.caseResultId ?? null,
      input.stepResultId ?? null,
      input.artifactType,
      input.storagePath,
      input.fileName ?? null,
      input.contentType ?? null,
      input.fileSize ?? null
    ]
  );
  return Number((result as { insertId: number }).insertId);
}

export async function recordLocatorAttempts(attempts: LocatorAttempt[]): Promise<void> {
  if (!attempts.length) {
    return;
  }
  for (const attempt of attempts) {
    if (!attempt.id) {
      continue;
    }
    if (attempt.success) {
      await mysqlPool.query(
        `
      UPDATE tp_element_locator
      SET last_success_at = NOW(3),
        success_count = COALESCE(success_count, 0) + 1,
        status = 'active',
        last_error = NULL,
        last_checked_at = NOW(3)
      WHERE id = ?
        `,
        [attempt.id]
      );
      continue;
    }
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();

      const [locatorRows] = await connection.query(
        "SELECT element_id AS elementId FROM tp_element_locator WHERE id = ? LIMIT 1",
        [attempt.id]
      );
      const elementId = Number((locatorRows as Array<{ elementId: number }>)[0]?.elementId || 0);

      if (!elementId) {
        await connection.rollback();
        continue;
      }

      const [priorityRows] = await connection.query(
        "SELECT COALESCE(MAX(priority), 0) AS maxPriority FROM tp_element_locator WHERE element_id = ?",
        [elementId]
      );
      const nextPriority = Number((priorityRows as Array<{ maxPriority: number }>)[0]?.maxPriority || 0) + 10;

      await connection.query(
        `
        UPDATE tp_element_locator
        SET last_failed_at = NOW(3),
          failed_count = COALESCE(failed_count, 0) + 1,
          status = 'failed',
          is_primary = 0,
          priority = ?,
          last_error = ?,
          last_checked_at = NOW(3)
        WHERE id = ?
        `,
        [nextPriority, safeDbText(attempt.errorMessage), attempt.id]
      );

      const [elementRows] = await connection.query("SELECT primary_locator_id AS primaryLocatorId FROM tp_element WHERE id = ?", [
        elementId
      ]);
      const currentPrimaryId = Number((elementRows as Array<{ primaryLocatorId: number | null }>)[0]?.primaryLocatorId || 0);

      if (currentPrimaryId === Number(attempt.id)) {
        const [replacementRows] = await connection.query(
          `
          SELECT id
          FROM tp_element_locator
          WHERE element_id = ? AND id <> ? AND status = 'active'
          ORDER BY is_primary DESC, COALESCE(priority, 999999) ASC, score DESC, id ASC
          LIMIT 1
          `,
          [elementId, attempt.id]
        );
        const replacementId = Number((replacementRows as Array<{ id: number }>)[0]?.id || 0);
        await connection.query("UPDATE tp_element_locator SET is_primary = 0 WHERE element_id = ?", [elementId]);
        if (replacementId) {
          await connection.query("UPDATE tp_element_locator SET is_primary = 1 WHERE id = ? AND element_id = ?", [
            replacementId,
            elementId
          ]);
          await connection.query("UPDATE tp_element SET primary_locator_id = ?, updated_at = NOW(3) WHERE id = ?", [
            replacementId,
            elementId
          ]);
        } else {
          await connection.query(
            "UPDATE tp_element SET primary_locator_id = NULL, valid_status = 0, last_error = ?, updated_at = NOW(3) WHERE id = ?",
            [safeDbText(attempt.errorMessage), elementId]
          );
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export async function promoteMatchedLocator(input: {
  elementId?: number | null;
  locator?: ResolvedLocatorMatch | null;
}): Promise<number | null> {
  const elementId = Number(input.elementId || 0);
  const locator = input.locator;
  if (!locator) {
    return null;
  }
  const locatorType = String(locator?.locatorType || "").trim();
  const locatorValue = String(locator?.locatorValue || "").trim();
  if (!elementId || !locatorType || !locatorValue) {
    return null;
  }

  const connection = await mysqlPool.getConnection();
  try {
    await connection.beginTransaction();

    let locatorId = Number(locator?.id || 0);
    if (locatorId) {
      const [ownerRows] = await connection.query(
        "SELECT element_id AS elementId FROM tp_element_locator WHERE id = ? LIMIT 1",
        [locatorId]
      );
      const ownerElementId = Number((ownerRows as Array<{ elementId: number }>)[0]?.elementId || 0);
      if (ownerElementId !== elementId) {
        locatorId = 0;
      }
    }

    if (!locatorId) {
      const [existingRows] = await connection.query(
        `
        SELECT id
        FROM tp_element_locator
        WHERE element_id = ? AND locator_type = ? AND locator_value = ?
        LIMIT 1
        `,
        [elementId, locatorType, locatorValue]
      );
      locatorId = Number((existingRows as Array<{ id: number }>)[0]?.id || 0);
    }

    if (!locatorId) {
      const [result] = await connection.query(
        `
        INSERT INTO tp_element_locator (
          element_id, locator_type, locator_value, locator_expression, score,
          is_primary, is_unique, is_visible, is_actionable, source, status,
          priority, confidence, last_success_at, success_count, last_checked_at
        )
        VALUES (?, ?, ?, ?, ?, 0, 1, 1, 1, 'execution', 'active', 1, ?, NOW(3), 1, NOW(3))
        `,
        [
          elementId,
          locatorType,
          locatorValue,
          locator.locatorExpression ?? null,
          Math.round(Number(locator.confidence || locator.score || 80)),
          locator.confidence ?? null
        ]
      );
      locatorId = Number((result as { insertId: number }).insertId);
    }

    await connection.query("UPDATE tp_element_locator SET is_primary = 0 WHERE element_id = ?", [elementId]);
    await connection.query(
      `
      UPDATE tp_element_locator
      SET is_primary = 1,
        status = 'active',
        priority = 1,
        locator_expression = COALESCE(?, locator_expression),
        last_success_at = NOW(3),
        last_checked_at = NOW(3),
        updated_at = NOW(3)
      WHERE id = ? AND element_id = ?
      `,
      [locator.locatorExpression ?? null, locatorId, elementId]
    );
    await connection.query(
      `
      UPDATE tp_element
      SET primary_locator_id = ?,
        valid_status = 1,
        last_validated_at = NOW(3),
        last_error = NULL,
        updated_at = NOW(3)
      WHERE id = ?
      `,
      [locatorId, elementId]
    );

    await connection.commit();
    return locatorId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createLocatorHealLog(input: {
  projectId: number;
  elementId?: number | null;
  caseId: number;
  stepId: number;
  jobId: number;
  stepResultId: number;
  pageUrl?: string | null;
  pageTitle?: string | null;
  action: string;
  oldLocator: Record<string, unknown> | null;
  attemptedLocators: Array<Record<string, unknown>>;
  aiInput: Record<string, unknown>;
  aiCandidates: Array<Record<string, unknown>>;
  selectedLocator?: Record<string, unknown> | null;
  confidence?: number | null;
  reason?: string | null;
  status: "generated" | "verified" | "applied" | "rejected" | "failed" | "rejected_by_confidence" | "visual_failed";
}): Promise<number> {
  const [result] = await mysqlPool.query(
    `
    INSERT INTO tp_locator_heal_log (
      project_id, element_id, case_id, step_id, job_id, step_result_id,
      page_url, page_title, action, old_locator_json, attempted_locators_json,
      ai_input_json, ai_candidates_json, selected_locator_json, confidence,
      reason, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
      CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)
    `,
    [
      input.projectId,
      input.elementId ?? null,
      input.caseId,
      input.stepId,
      input.jobId,
      input.stepResultId,
      input.pageUrl ?? null,
      input.pageTitle ?? null,
      input.action,
      JSON.stringify(input.oldLocator ?? {}),
      JSON.stringify(input.attemptedLocators ?? []),
      JSON.stringify(input.aiInput ?? {}),
      JSON.stringify(input.aiCandidates ?? []),
      JSON.stringify(input.selectedLocator ?? {}),
      input.confidence ?? null,
      safeDbText(input.reason, 4000),
      input.status
    ]
  );
  return Number((result as { insertId: number }).insertId);
}

export async function upsertHealedLocator(input: {
  elementId: number;
  locatorType: string;
  locatorValue: string;
  locatorExpression?: string | null;
  confidence?: number | null;
  source?: "ai" | "healed";
}): Promise<number> {
  const [existingRows] = await mysqlPool.query(
    `
    SELECT id
    FROM tp_element_locator
    WHERE element_id = ? AND locator_type = ? AND locator_value = ?
    LIMIT 1
    `,
    [input.elementId, input.locatorType, input.locatorValue]
  );
  const existingId = Number((existingRows as Array<{ id: number }>)[0]?.id || 0);
  if (existingId) {
    await mysqlPool.query(
      `
      UPDATE tp_element_locator
      SET locator_expression = COALESCE(?, locator_expression),
        source = ?,
        status = 'active',
        priority = LEAST(COALESCE(priority, 999999), 30),
        confidence = ?,
        updated_at = NOW(3)
      WHERE id = ?
      `,
      [
        input.locatorExpression ?? null,
        input.source ?? "healed",
        input.confidence ?? null,
        existingId
      ]
    );
    return existingId;
  }

  const [result] = await mysqlPool.query(
    `
    INSERT INTO tp_element_locator (
      element_id, locator_type, locator_value, locator_expression, score,
      is_primary, is_unique, is_visible, is_actionable, source, status,
      priority, confidence
    )
    VALUES (?, ?, ?, ?, ?, 0, 1, 1, 1, ?, 'active', 30, ?)
    `,
    [
      input.elementId,
      input.locatorType,
      input.locatorValue,
      input.locatorExpression ?? null,
      Math.round(Number(input.confidence || 0)),
      input.source ?? "healed",
      input.confidence ?? null
    ]
  );
  return Number((result as { insertId: number }).insertId);
}

export function parsePayload(raw: string): ExecutionQueuePayload {
  return parseJson<ExecutionQueuePayload>(raw, {
    jobNo: "",
    projectId: 0,
    environmentId: null,
    browser: "chromium",
    caseIds: [],
    config: {
      headless: true,
      retries: 0,
      timeoutMs: 30000,
      screenshot: true,
      video: true,
      trace: false
    }
  });
}
