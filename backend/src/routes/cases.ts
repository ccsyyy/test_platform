import { Router } from "express";
import { z } from "zod";
import { mysqlPool } from "../db/mysql.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { assertProjectAccess, getProjectIdByCase } from "../middleware/projectAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const casesRouter = Router();

casesRouter.use(requireAuth);

const caseSchema = z.object({
  projectId: z.number().int().positive(),
  caseGroupId: z.number().int().positive().optional().nullable(),
  caseCode: z.string().min(1).max(64).optional(),
  caseName: z.string().min(1).max(200),
  caseDesc: z.string().max(2000).optional(),
  priority: z.enum(["high", "medium", "low"]).default("medium")
});

const updateCaseSchema = z.object({
  caseGroupId: z.number().int().positive().optional().nullable(),
  caseCode: z.string().min(1).max(64).optional(),
  caseName: z.string().min(1).max(200).optional(),
  caseDesc: z.string().max(2000).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.number().int().min(0).max(1).optional()
});

const caseStepSchema = z.object({
  stepOrder: z.number().int().positive().optional(),
  stepName: z.string().min(1).max(200).optional(),
  action: z.string().min(1).max(100),
  elementId: z.number().int().positive().optional().nullable(),
  stepDsl: z.record(z.string(), z.unknown()).optional().default({}),
  locatorSnapshot: z.array(z.record(z.string(), z.unknown())).optional().nullable()
});

const updateCaseStepSchema = z
  .object({
    stepOrder: z.number().int().positive().optional(),
    stepName: z.string().min(1).max(200).optional(),
    action: z.string().min(1).max(100).optional(),
    elementId: z.number().int().positive().optional().nullable(),
    stepDsl: z.record(z.string(), z.unknown()).optional(),
    locatorSnapshot: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
    status: z.number().int().min(0).max(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "缺少要更新的步骤字段");

async function moveInactiveCaseStepsOutOfOrder(
  executor: Pick<typeof mysqlPool, "query">,
  caseId: number
) {
  await executor.query(
    `
    UPDATE tp_case_step
    SET step_order = id + 1000000, updated_at = NOW(3)
    WHERE case_id = ? AND COALESCE(status, 0) <> 1 AND step_order <> id + 1000000
    `,
    [caseId]
  );
}

async function normalizeCaseStepOrders(
  executor: Pick<typeof mysqlPool, "query">,
  caseId: number
) {
  await moveInactiveCaseStepsOutOfOrder(executor, caseId);
  const [rows] = await executor.query(
    `
    SELECT id
    FROM tp_case_step
    WHERE case_id = ? AND status = 1
    ORDER BY step_order ASC, id ASC
    `,
    [caseId]
  );
  let order = 1;
  for (const row of rows as Array<{ id: number }>) {
    await executor.query(
      `
      UPDATE tp_case_step
      SET step_order = ?, updated_at = NOW(3)
      WHERE id = ?
      `,
      [order, row.id]
    );
    order += 1;
  }
}

async function getCaseInfoForStep(caseId: number, stepId: number): Promise<{ caseId: number; projectId: number } | null> {
  const directProjectId = await getProjectIdByCase(caseId);
  if (directProjectId) {
    return { caseId, projectId: directProjectId };
  }
  const [rows] = await mysqlPool.query(
    `
    SELECT s.case_id AS caseId, tc.project_id AS projectId
    FROM tp_case_step s
    JOIN tp_test_case tc ON tc.id = s.case_id
    WHERE s.id = ?
    LIMIT 1
    `,
    [stepId]
  );
  const row = (rows as Array<{ caseId: number; projectId: number }>)[0];
  return row ? { caseId: row.caseId, projectId: row.projectId } : null;
}

casesRouter.get(
  "/case-groups",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.query.projectId);
    await assertProjectAccess(projectId, request.user!);
    const [rows] = await mysqlPool.query(
      `
      SELECT id, project_id AS projectId, group_name AS groupName,
        description, created_at AS createdAt, updated_at AS updatedAt
      FROM tp_case_group
      WHERE project_id = ?
      ORDER BY id ASC
      `,
      [projectId]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

const caseGroupSchema = z.object({
  projectId: z.number().int().positive(),
  groupName: z.string().min(1).max(200),
  description: z.string().max(1000).optional()
});

const updateCaseGroupSchema = z.object({
  groupName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional()
});

casesRouter.post(
  "/case-groups",
  asyncHandler(async (request, response) => {
    const body = caseGroupSchema.parse(request.body);
    await assertProjectAccess(body.projectId, request.user!, "edit_cases");
    const [result] = await mysqlPool.query(
      `
      INSERT INTO tp_case_group (project_id, group_name, description, created_by)
      VALUES (?, ?, ?, ?)
      `,
      [body.projectId, body.groupName, body.description ?? null, request.user?.id ?? null]
    );
    response.status(201).json({
      code: 201,
      message: "created",
      data: { groupId: Number((result as { insertId: number }).insertId) }
    });
  })
);

casesRouter.patch(
  "/case-groups/:groupId",
  asyncHandler(async (request, response) => {
    const groupId = Number(request.params.groupId);
    const [rows] = await mysqlPool.query("SELECT project_id AS projectId FROM tp_case_group WHERE id = ? LIMIT 1", [
      groupId
    ]);
    const projectId = (rows as Array<{ projectId: number }>)[0]?.projectId;
    if (!projectId) {
      throw new HttpError(404, "模块不存在");
    }
    await assertProjectAccess(projectId, request.user!, "edit_cases");
    const body = updateCaseGroupSchema.parse(request.body);
    await mysqlPool.query(
      `
      UPDATE tp_case_group
      SET group_name = COALESCE(?, group_name),
        description = COALESCE(?, description),
        updated_at = NOW(3)
      WHERE id = ?
      `,
      [body.groupName ?? null, body.description ?? null, groupId]
    );
    response.json({ code: 200, message: "success", data: { groupId } });
  })
);

casesRouter.delete(
  "/case-groups/:groupId",
  asyncHandler(async (request, response) => {
    const groupId = Number(request.params.groupId);
    const [rows] = await mysqlPool.query("SELECT project_id AS projectId FROM tp_case_group WHERE id = ? LIMIT 1", [
      groupId
    ]);
    const projectId = (rows as Array<{ projectId: number }>)[0]?.projectId;
    if (!projectId) {
      throw new HttpError(404, "模块不存在");
    }
    await assertProjectAccess(projectId, request.user!, "edit_cases");
    await mysqlPool.query("UPDATE tp_test_case SET case_group_id = NULL, updated_at = NOW(3) WHERE case_group_id = ?", [
      groupId
    ]);
    await mysqlPool.query("DELETE FROM tp_case_group WHERE id = ?", [groupId]);
    response.json({ code: 200, message: "success", data: { groupId } });
  })
);

casesRouter.delete(
  "/test-cases/:caseId",
  asyncHandler(async (request, response) => {
    const caseId = Number(request.params.caseId);
    const projectId = await getProjectIdByCase(caseId);
    if (!projectId) {
      throw new HttpError(404, "用例不存在");
    }
    await assertProjectAccess(projectId, request.user!, "edit_cases");
    await mysqlPool.query(
      `
      UPDATE tp_test_case
      SET status = 0, updated_at = NOW(3)
      WHERE id = ?
      `,
      [caseId]
    );
    await mysqlPool.query(
      `
      UPDATE tp_case_step
      SET status = 0, step_order = id + 1000000, updated_at = NOW(3)
      WHERE case_id = ?
      `,
      [caseId]
    );
    response.json({ code: 200, message: "success", data: { caseId } });
  })
);

casesRouter.get(
  "/test-cases",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.query.projectId);
    await assertProjectAccess(projectId, request.user!);
    const keyword = typeof request.query.keyword === "string" ? request.query.keyword : "";
    const groupId = Number(request.query.groupId);
    const [rows] = await mysqlPool.query(
      `
      SELECT c.id, c.project_id AS projectId, c.case_code AS caseCode,
        c.case_name AS caseName, c.case_desc AS caseDesc, c.priority,
        c.case_group_id AS caseGroupId, g.group_name AS groupName,
        c.status, c.version_no AS versionNo,
        COUNT(s.id) AS stepCount,
        u.username AS createdByName, c.created_at AS createdAt, c.updated_at AS updatedAt,
        (
          SELECT r.status
          FROM tp_execution_case_result r
          JOIN tp_execution_job j ON j.id = r.job_id
          WHERE r.case_id = c.id
          ORDER BY COALESCE(r.finished_at, r.started_at, j.created_at) DESC, r.id DESC
          LIMIT 1
        ) AS latestExecutionStatus,
        (
          SELECT COALESCE(r.finished_at, r.started_at, j.created_at)
          FROM tp_execution_case_result r
          JOIN tp_execution_job j ON j.id = r.job_id
          WHERE r.case_id = c.id
          ORDER BY COALESCE(r.finished_at, r.started_at, j.created_at) DESC, r.id DESC
          LIMIT 1
        ) AS latestExecutionAt
      FROM tp_test_case c
      LEFT JOIN tp_case_group g ON g.id = c.case_group_id
      LEFT JOIN sys_user u ON u.id = c.created_by
      LEFT JOIN tp_case_step s ON s.case_id = c.id AND s.status = 1
      WHERE c.project_id = ? AND c.status <> 0
        AND (? = 0 OR c.case_group_id = ?)
        AND (? = '' OR c.case_name LIKE CONCAT('%', ?, '%') OR c.case_code LIKE CONCAT('%', ?, '%'))
      GROUP BY c.id
      ORDER BY c.id DESC
      LIMIT 100
      `,
      [
        projectId,
        Number.isFinite(groupId) ? groupId : 0,
        Number.isFinite(groupId) ? groupId : 0,
        keyword,
        keyword,
        keyword
      ]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

casesRouter.post(
  "/test-cases",
  asyncHandler(async (request, response) => {
    const body = caseSchema.parse(request.body);
    await assertProjectAccess(body.projectId, request.user!, "edit_cases");
    const caseCode = body.caseCode ?? `CASE_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const [result] = await mysqlPool.query(
      `
      INSERT INTO tp_test_case (
        project_id, case_group_id, case_code, case_name, case_desc, priority, status, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `,
      [
        body.projectId,
        body.caseGroupId ?? null,
        caseCode,
        body.caseName,
        body.caseDesc ?? null,
        body.priority,
        request.user?.id ?? null
      ]
    );
    response.status(201).json({
      code: 201,
      message: "created",
      data: { caseId: Number((result as { insertId: number }).insertId), caseCode }
    });
  })
);

casesRouter.get(
  "/test-cases/:caseId",
  asyncHandler(async (request, response) => {
    const caseId = Number(request.params.caseId);
    const projectId = await getProjectIdByCase(caseId);
    if (!projectId) {
      throw new HttpError(404, "用例不存在");
    }
    await assertProjectAccess(projectId, request.user!);

    const [caseRows] = await mysqlPool.query(
      `
      SELECT c.id, c.project_id AS projectId, c.case_group_id AS caseGroupId,
        g.group_name AS groupName, c.case_code AS caseCode, c.case_name AS caseName,
        c.case_desc AS caseDesc, c.priority, c.status, c.version_no AS versionNo,
        (
          SELECT COUNT(*)
          FROM tp_case_step s2
          WHERE s2.case_id = c.id AND s2.status = 1
        ) AS visibleStepCount,
        (
          SELECT COUNT(*)
          FROM tp_case_step s3
          WHERE s3.case_id = c.id AND s3.status = 1
        ) AS stepTotalCount,
        u.username AS createdByName, c.created_at AS createdAt, c.updated_at AS updatedAt
      FROM tp_test_case c
      LEFT JOIN tp_case_group g ON g.id = c.case_group_id
      LEFT JOIN sys_user u ON u.id = c.created_by
      WHERE c.id = ?
      LIMIT 1
      `,
      [caseId]
    );
    const testCase = (caseRows as Array<Record<string, unknown>>)[0];
    const [steps] = await mysqlPool.query(
      `
      SELECT s.id, s.step_order AS stepOrder, s.step_name AS stepName,
        s.action, s.element_id AS elementId, e.element_name AS elementName,
        e.element_type AS elementType, s.step_dsl_json AS stepDsl,
        s.locator_snapshot_json AS locatorSnapshot
      FROM tp_case_step s
      LEFT JOIN tp_element e ON e.id = s.element_id
      WHERE s.case_id = ? AND s.status = 1
      ORDER BY s.step_order ASC
      `,
      [caseId]
    );
    const [usedElements] = await mysqlPool.query(
      `
      SELECT DISTINCT e.id, e.element_name AS elementName, e.element_type AS elementType,
        p.page_name AS pageName, c.component_name AS componentName
      FROM tp_case_step s
      JOIN tp_element e ON e.id = s.element_id
      LEFT JOIN tp_page p ON p.id = e.page_id
      LEFT JOIN tp_component c ON c.id = e.component_id
      WHERE s.case_id = ? AND s.status = 1
      ORDER BY e.id ASC
      `,
      [caseId]
    );
    const [recentExecutions] = await mysqlPool.query(
      `
      SELECT r.id, j.job_no AS jobNo, j.browser, r.status,
        r.duration_ms AS durationMs, r.error_message AS errorMessage,
        r.started_at AS startedAt, r.finished_at AS finishedAt
      FROM tp_execution_case_result r
      JOIN tp_execution_job j ON j.id = r.job_id
      WHERE r.case_id = ?
      ORDER BY COALESCE(r.finished_at, r.started_at, j.created_at) DESC, r.id DESC
      LIMIT 10
      `,
      [caseId]
    );
    const [reports] = await mysqlPool.query(
      `
      SELECT DISTINCT j.id AS jobId, j.job_no AS jobNo, j.status, j.finished_at AS finishedAt,
        a.id AS artifactId, a.file_name AS traceFileName
      FROM tp_execution_case_result r
      JOIN tp_execution_job j ON j.id = r.job_id
      LEFT JOIN tp_artifact a ON a.job_id = j.id AND a.artifact_type IN ('trace', 'report')
      WHERE r.case_id = ?
      ORDER BY j.id DESC
      LIMIT 10
      `,
      [caseId]
    );

    response.json({
      code: 200,
      message: "success",
      data: {
        ...testCase,
        steps,
        variables: [],
        usedElements,
        recentExecutions,
        reports
      }
    });
  })
);

casesRouter.patch(
  "/test-cases/:caseId",
  asyncHandler(async (request, response) => {
    const caseId = Number(request.params.caseId);
    const projectId = await getProjectIdByCase(caseId);
    if (!projectId) {
      throw new HttpError(404, "用例不存在");
    }
    await assertProjectAccess(projectId, request.user!, "edit_cases");
    const body = updateCaseSchema.parse(request.body);
    await mysqlPool.query(
      `
      UPDATE tp_test_case
      SET case_group_id = COALESCE(?, case_group_id),
        case_code = COALESCE(?, case_code),
        case_name = COALESCE(?, case_name),
        case_desc = COALESCE(?, case_desc),
        priority = COALESCE(?, priority),
        status = COALESCE(?, status),
        updated_at = NOW(3)
      WHERE id = ?
      `,
      [
        body.caseGroupId ?? null,
        body.caseCode ?? null,
        body.caseName ?? null,
        body.caseDesc ?? null,
        body.priority ?? null,
        body.status ?? null,
        caseId
      ]
    );
    response.json({ code: 200, message: "success", data: { caseId } });
  })
);

casesRouter.post(
  "/test-cases/:caseId/copy",
  asyncHandler(async (request, response) => {
    const caseId = Number(request.params.caseId);
    const projectId = await getProjectIdByCase(caseId);
    if (!projectId) {
      throw new HttpError(404, "用例不存在");
    }
    await assertProjectAccess(projectId, request.user!, "edit_cases");
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      const [caseRows] = await connection.query(
        "SELECT * FROM tp_test_case WHERE id = ? LIMIT 1",
        [caseId]
      );
      const source = (caseRows as Array<{
        project_id: number;
        case_group_id: number | null;
        case_code: string | null;
        case_name: string;
        case_desc: string | null;
        priority: string;
      }>)[0];
      const copyCode = `${source.case_code || "CASE"}_COPY_${Date.now().toString().slice(-6)}`;
      const [result] = await connection.query(
        `
        INSERT INTO tp_test_case (
          project_id, case_group_id, case_code, case_name, case_desc, priority, status, created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        `,
        [
          source.project_id,
          source.case_group_id,
          copyCode,
          `${source.case_name} 副本`,
          source.case_desc,
          source.priority,
          request.user?.id ?? null
        ]
      );
      const newCaseId = Number((result as { insertId: number }).insertId);
      await connection.query(
        `
        INSERT INTO tp_case_step (
          case_id, step_order, step_name, action, element_id, step_dsl_json, locator_snapshot_json, status
        )
        SELECT ?, step_order, step_name, action, element_id, step_dsl_json, locator_snapshot_json, status
        FROM tp_case_step
        WHERE case_id = ? AND status = 1
        ORDER BY step_order ASC
        `,
        [newCaseId, caseId]
      );
      await connection.commit();
      response.status(201).json({ code: 201, message: "created", data: { caseId: newCaseId, caseCode: copyCode } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

casesRouter.get(
  "/test-cases/:caseId/steps",
  asyncHandler(async (request, response) => {
    const caseId = Number(request.params.caseId);
    const projectId = await getProjectIdByCase(caseId);
    if (!projectId) {
      throw new HttpError(404, "用例不存在");
    }
    await assertProjectAccess(projectId, request.user!);
    const [rows] = await mysqlPool.query(
      `
      SELECT s.id, s.case_id AS caseId, s.step_order AS stepOrder,
        s.step_name AS stepName, s.action, s.element_id AS elementId,
        s.step_dsl_json AS stepDsl, s.locator_snapshot_json AS locatorSnapshot,
        e.element_name AS elementName
      FROM tp_case_step s
      LEFT JOIN tp_element e ON e.id = s.element_id
      WHERE s.case_id = ? AND s.status = 1
      ORDER BY s.step_order ASC
      `,
      [caseId]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

casesRouter.post(
  "/test-cases/:caseId/steps",
  asyncHandler(async (request, response) => {
    const caseId = Number(request.params.caseId);
    const projectId = await getProjectIdByCase(caseId);
    if (!projectId) {
      throw new HttpError(404, "用例不存在");
    }
    await assertProjectAccess(projectId, request.user!, "edit_cases");
    const body = caseStepSchema.parse(request.body);
    await moveInactiveCaseStepsOutOfOrder(mysqlPool, caseId);
    const [maxRows] = await mysqlPool.query(
      `
      SELECT COALESCE(MAX(step_order), 0) AS maxOrder
      FROM tp_case_step
      WHERE case_id = ? AND status = 1
      `,
      [caseId]
    );
    const maxOrder = Number((maxRows as Array<{ maxOrder: number }>)[0]?.maxOrder || 0);
    const stepOrder = body.stepOrder && body.stepOrder > 0 ? body.stepOrder : maxOrder + 1;
    const stepName = body.stepName?.trim() || `步骤 ${stepOrder}`;
    const [result] = await mysqlPool.query(
      `
      INSERT INTO tp_case_step (
        case_id, step_order, step_name, action, element_id, step_dsl_json, locator_snapshot_json, status
      )
      VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), 1)
      `,
      [
        caseId,
        stepOrder,
        stepName,
        body.action,
        body.elementId ?? null,
        JSON.stringify(body.stepDsl ?? {}),
        JSON.stringify(body.locatorSnapshot ?? [])
      ]
    );
    await normalizeCaseStepOrders(mysqlPool, caseId);
    response.status(201).json({
      code: 201,
      message: "created",
      data: { stepId: Number((result as { insertId: number }).insertId) }
    });
  })
);

casesRouter.patch(
  "/test-cases/:caseId/steps/:stepId",
  asyncHandler(async (request, response) => {
    const caseId = Number(request.params.caseId);
    const stepId = Number(request.params.stepId);
    const projectId = await getProjectIdByCase(caseId);
    if (!projectId) {
      throw new HttpError(404, "用例不存在");
    }
    await assertProjectAccess(projectId, request.user!, "edit_cases");
    const body = updateCaseStepSchema.parse(request.body);
    await moveInactiveCaseStepsOutOfOrder(mysqlPool, caseId);
    await mysqlPool.query(
      `
      UPDATE tp_case_step
      SET step_order = COALESCE(?, step_order),
        step_name = COALESCE(?, step_name),
        action = COALESCE(?, action),
        element_id = CASE WHEN ? = 1 THEN ? ELSE element_id END,
        step_dsl_json = COALESCE(CAST(? AS JSON), step_dsl_json),
        locator_snapshot_json = COALESCE(CAST(? AS JSON), locator_snapshot_json),
        status = COALESCE(?, status),
        updated_at = NOW(3)
      WHERE id = ? AND case_id = ?
      `,
      [
        body.stepOrder ?? null,
        body.stepName ?? null,
        body.action ?? null,
        Object.prototype.hasOwnProperty.call(body, "elementId") ? 1 : 0,
        Object.prototype.hasOwnProperty.call(body, "elementId") ? (body.elementId ?? null) : null,
        Object.prototype.hasOwnProperty.call(body, "stepDsl") ? JSON.stringify(body.stepDsl ?? {}) : null,
        Object.prototype.hasOwnProperty.call(body, "locatorSnapshot")
          ? JSON.stringify(body.locatorSnapshot ?? [])
          : null,
        body.status ?? null,
        stepId,
        caseId
      ]
    );
    await normalizeCaseStepOrders(mysqlPool, caseId);
    response.json({ code: 200, message: "success", data: { stepId } });
  })
);

casesRouter.delete(
  "/test-cases/:caseId/steps/:stepId",
  asyncHandler(async (request, response) => {
    const caseId = Number(request.params.caseId);
    const stepId = Number(request.params.stepId);
    const caseInfo = await getCaseInfoForStep(caseId, stepId);
    if (!caseInfo) {
      throw new HttpError(404, "用例不存在");
    }
    await assertProjectAccess(caseInfo.projectId, request.user!, "edit_cases");
    await mysqlPool.query(
      `
      UPDATE tp_case_step
      SET status = 0, step_order = id + 1000000, updated_at = NOW(3)
      WHERE id = ? AND case_id = ?
      `,
      [stepId, caseInfo.caseId]
    );
    await normalizeCaseStepOrders(mysqlPool, caseInfo.caseId);
    response.json({ code: 200, message: "success", data: { stepId, caseId: caseInfo.caseId } });
  })
);
