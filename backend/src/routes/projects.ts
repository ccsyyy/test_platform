import { Router } from "express";
import { z } from "zod";
import { mysqlPool } from "../db/mysql.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { assertProjectAccess, isSystemAdmin } from "../middleware/projectAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

const projectSchema = z.object({
  projectCode: z.string().min(1).max(64),
  projectName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  defaultBaseUrl: z.string().url().max(1000).optional(),
  defaultEnvName: z.string().min(1).max(100).default("测试环境"),
  ownerId: z.number().int().positive().optional(),
  initialMemberIds: z.array(z.number().int().positive()).default([])
});

const projectUpdateSchema = z
  .object({
    projectCode: z.string().min(1).max(64).optional(),
    projectName: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional().nullable(),
    status: z.union([z.literal(1), z.literal(2)]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "缺少要更新的项目字段");

const environmentSchema = z.object({
  envCode: z.string().min(1).max(64),
  envName: z.string().min(1).max(100),
  envType: z.enum(["local", "test", "staging", "prod"]).default("test"),
  baseUrl: z.string().url().max(1000),
  allowExecution: z.boolean().default(true),
  requireConfirm: z.boolean().default(false),
  description: z.string().max(1000).optional()
});

const environmentUpdateSchema = z
  .object({
    envCode: z.string().min(1).max(64).optional(),
    envName: z.string().min(1).max(100).optional(),
    envType: z.enum(["local", "test", "staging", "prod"]).optional(),
    baseUrl: z.string().url().max(1000).optional(),
    allowExecution: z.boolean().optional(),
    requireConfirm: z.boolean().optional(),
    description: z.string().max(1000).optional().nullable()
  })
  .refine((value) => Object.keys(value).length > 0, "缺少要更新的环境字段");

const memberSchema = z.object({
  userId: z.number().int().positive(),
  projectRole: z.enum(["project_admin", "test_lead", "tester", "viewer"]).default("tester")
});

const memberUpdateSchema = z.object({
  projectRole: z.enum(["project_admin", "test_lead", "tester", "viewer"]).optional(),
  status: z.enum(["active", "disabled", "removed"]).optional()
});

async function logProjectOperation(
  user: Express.Request["user"],
  projectId: number,
  action: string,
  detail: Record<string, unknown>
) {
  await mysqlPool.query(
    `
    INSERT INTO sys_operation_log (user_id, project_id, action, resource_type, detail_json)
    VALUES (?, ?, ?, 'project_member', CAST(? AS JSON))
    `,
    [user?.id ?? null, projectId, action, JSON.stringify(detail)]
  );
}

projectsRouter.get(
  "/projects",
  asyncHandler(async (request, response) => {
    const [rows] = await mysqlPool.query(
      `
      SELECT p.id, p.project_code AS projectCode, p.project_name AS projectName,
        p.description, p.status, p.created_at AS createdAt, p.updated_at AS updatedAt,
        COALESCE(pm.project_role, IF(? = 'admin', 'project_admin', NULL)) AS projectRole,
        (SELECT COUNT(*) FROM tp_project_member m WHERE m.project_id = p.id AND m.status = 'active') AS memberCount,
        (SELECT COUNT(*) FROM tp_environment e WHERE e.project_id = p.id) AS environmentCount,
        (SELECT COUNT(*) FROM tp_recording_session r WHERE r.project_id = p.id) AS recordingCount,
        (SELECT COUNT(*) FROM tp_element el WHERE el.project_id = p.id AND el.status <> 0) AS elementCount,
        (SELECT COUNT(*) FROM tp_test_case c WHERE c.project_id = p.id AND c.status <> 0) AS caseCount,
        (SELECT COUNT(*) FROM tp_execution_job j WHERE j.project_id = p.id) AS jobCount,
        (SELECT COUNT(*) FROM tp_execution_job j WHERE j.project_id = p.id) AS reportCount,
        (SELECT MAX(j.created_at) FROM tp_execution_job j WHERE j.project_id = p.id) AS latestExecutionAt,
        (
          SELECT j.status
          FROM tp_execution_job j
          WHERE j.project_id = p.id
          ORDER BY j.id DESC
          LIMIT 1
        ) AS latestExecutionStatus
      FROM tp_project p
      LEFT JOIN tp_project_member pm
        ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'active'
      WHERE p.status <> 0
        AND (? = 'admin' OR p.owner_id = ? OR pm.id IS NOT NULL)
      ORDER BY p.id DESC
      `,
      [request.user?.roleCode, request.user?.id, request.user?.roleCode, request.user?.id]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

projectsRouter.post(
  "/projects",
  requireRole("admin", "test_lead"),
  asyncHandler(async (request, response) => {
    const body = projectSchema.parse(request.body);
    const connection = await mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      const ownerId = body.ownerId ?? request.user?.id ?? null;
      const [result] = await connection.query(
        `
        INSERT INTO tp_project (project_code, project_name, description, owner_id)
        VALUES (?, ?, ?, ?)
        `,
        [body.projectCode, body.projectName, body.description ?? null, ownerId]
      );
      const projectId = Number((result as { insertId: number }).insertId);
      if (ownerId) {
        await connection.query(
          `
          INSERT INTO tp_project_member (project_id, user_id, project_role, status, created_by)
          VALUES (?, ?, 'project_admin', 'active', ?)
          `,
          [projectId, ownerId, request.user?.id ?? ownerId]
        );
      }
      for (const userId of new Set(body.initialMemberIds)) {
        if (userId === ownerId) continue;
        await connection.query(
          `
          INSERT IGNORE INTO tp_project_member (project_id, user_id, project_role, status, created_by)
          VALUES (?, ?, 'tester', 'active', ?)
          `,
          [projectId, userId, request.user?.id ?? null]
        );
      }
      if (body.defaultBaseUrl) {
        await connection.query(
          `
          INSERT INTO tp_environment (
            project_id, env_code, env_name, env_type, base_url,
            allow_execution, require_confirm, description
          )
          VALUES (?, 'default', ?, 'test', ?, 1, 0, '项目创建时生成的默认环境')
          `,
          [projectId, body.defaultEnvName, body.defaultBaseUrl]
        );
      }
      await connection.commit();
      response.status(201).json({ code: 201, message: "created", data: { projectId } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

projectsRouter.delete(
  "/projects/:projectId",
  requireRole("admin", "test_lead"),
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    await mysqlPool.query(
      `
      UPDATE tp_project
      SET status = 0, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
      `,
      [projectId]
    );
    response.json({ code: 200, message: "success", data: { projectId } });
  })
);

projectsRouter.patch(
  "/projects/:projectId",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    const body = projectUpdateSchema.parse(request.body);
    await mysqlPool.query(
      `
      UPDATE tp_project
      SET project_code = COALESCE(?, project_code),
        project_name = COALESCE(?, project_name),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
      `,
      [body.projectCode ?? null, body.projectName ?? null, body.description ?? null, body.status ?? null, projectId]
    );
    response.json({ code: 200, message: "success", data: { projectId } });
  })
);

projectsRouter.get(
  "/users",
  asyncHandler(async (request, response) => {
    const keyword = typeof request.query.keyword === "string" ? request.query.keyword.trim() : "";
    const [rows] = await mysqlPool.query(
      `
      SELECT u.id, u.username, u.display_name AS displayName, u.email,
        u.status, r.role_code AS roleCode
      FROM sys_user u
      JOIN sys_role r ON r.id = u.role_id
      WHERE u.status = 1
        AND (? = '' OR u.username LIKE CONCAT('%', ?, '%')
          OR u.display_name LIKE CONCAT('%', ?, '%')
          OR u.email LIKE CONCAT('%', ?, '%'))
      ORDER BY u.id ASC
      LIMIT 50
      `,
      [keyword, keyword, keyword, keyword]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

projectsRouter.get(
  "/projects/:projectId/members",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!);
    const [rows] = await mysqlPool.query(
      `
      SELECT m.id, m.project_id AS projectId, m.user_id AS userId,
        m.project_role AS projectRole, m.status, m.joined_at AS joinedAt,
        m.last_active_at AS lastActiveAt, m.created_at AS createdAt,
        u.username, u.display_name AS displayName, u.email,
        r.role_code AS systemRole
      FROM tp_project_member m
      JOIN sys_user u ON u.id = m.user_id
      JOIN sys_role r ON r.id = u.role_id
      WHERE m.project_id = ? AND m.status <> 'removed'
      ORDER BY FIELD(m.project_role, 'project_admin', 'test_lead', 'tester', 'viewer'), u.id ASC
      `,
      [projectId]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

projectsRouter.post(
  "/projects/:projectId/members",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_members");
    const body = memberSchema.parse(request.body);
    await mysqlPool.query(
      `
      INSERT INTO tp_project_member (project_id, user_id, project_role, status, created_by)
      VALUES (?, ?, ?, 'active', ?)
      ON DUPLICATE KEY UPDATE
        project_role = VALUES(project_role),
        status = 'active',
        updated_at = CURRENT_TIMESTAMP(3)
      `,
      [projectId, body.userId, body.projectRole, request.user?.id ?? null]
    );
    await logProjectOperation(request.user, projectId, "project_member.add", body);
    response.status(201).json({ code: 201, message: "created", data: null });
  })
);

projectsRouter.patch(
  "/projects/:projectId/members/:memberId",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    const memberId = Number(request.params.memberId);
    await assertProjectAccess(projectId, request.user!, "manage_members");
    const body = memberUpdateSchema.parse(request.body);
    if (!body.projectRole && !body.status) {
      throw new HttpError(400, "缺少要更新的成员字段");
    }
    await mysqlPool.query(
      `
      UPDATE tp_project_member
      SET project_role = COALESCE(?, project_role),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND project_id = ?
      `,
      [body.projectRole ?? null, body.status ?? null, memberId, projectId]
    );
    await logProjectOperation(request.user, projectId, "project_member.update", { memberId, ...body });
    response.json({ code: 200, message: "success", data: null });
  })
);

projectsRouter.delete(
  "/projects/:projectId/members/:memberId",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    const memberId = Number(request.params.memberId);
    await assertProjectAccess(projectId, request.user!, "manage_members");
    await mysqlPool.query(
      `
      UPDATE tp_project_member
      SET status = 'removed', updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND project_id = ?
      `,
      [memberId, projectId]
    );
    await logProjectOperation(request.user, projectId, "project_member.remove", { memberId });
    response.json({ code: 200, message: "success", data: null });
  })
);

projectsRouter.get(
  "/projects/:projectId/environments",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!);
    const [rows] = await mysqlPool.query(
      `
      SELECT id, project_id AS projectId, env_code AS envCode, env_name AS envName,
        env_type AS envType, base_url AS baseUrl, allow_execution AS allowExecution,
        require_confirm AS requireConfirm, description, created_at AS createdAt,
        updated_at AS updatedAt
      FROM tp_environment
      WHERE project_id = ?
      ORDER BY id DESC
      `,
      [projectId]
    );
    response.json({ code: 200, message: "success", data: rows });
  })
);

projectsRouter.post(
  "/projects/:projectId/environments",
  requireRole("admin", "test_lead"),
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    const body = environmentSchema.parse(request.body);
    const [result] = await mysqlPool.query(
      `
      INSERT INTO tp_environment (
        project_id, env_code, env_name, env_type, base_url,
        allow_execution, require_confirm, description
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        projectId,
        body.envCode,
        body.envName,
        body.envType,
        body.baseUrl,
        body.allowExecution ? 1 : 0,
        body.requireConfirm ? 1 : 0,
        body.description ?? null
      ]
    );
    response.status(201).json({ code: 201, message: "created", data: result });
  })
);

projectsRouter.patch(
  "/projects/:projectId/environments/:environmentId",
  requireRole("admin", "test_lead"),
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    const environmentId = Number(request.params.environmentId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    const body = environmentUpdateSchema.parse(request.body);
    await mysqlPool.query(
      `
      UPDATE tp_environment
      SET env_code = COALESCE(?, env_code),
        env_name = COALESCE(?, env_name),
        env_type = COALESCE(?, env_type),
        base_url = COALESCE(?, base_url),
        allow_execution = COALESCE(?, allow_execution),
        require_confirm = COALESCE(?, require_confirm),
        description = COALESCE(?, description),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND project_id = ?
      `,
      [
        body.envCode ?? null,
        body.envName ?? null,
        body.envType ?? null,
        body.baseUrl ?? null,
        typeof body.allowExecution === "boolean" ? (body.allowExecution ? 1 : 0) : null,
        typeof body.requireConfirm === "boolean" ? (body.requireConfirm ? 1 : 0) : null,
        body.description ?? null,
        environmentId,
        projectId
      ]
    );
    response.json({ code: 200, message: "success", data: null });
  })
);

projectsRouter.delete(
  "/projects/:projectId/environments/:environmentId",
  requireRole("admin", "test_lead"),
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    const environmentId = Number(request.params.environmentId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    await mysqlPool.query(
      `
      DELETE FROM tp_environment
      WHERE id = ? AND project_id = ?
      `,
      [environmentId, projectId]
    );
    response.json({ code: 200, message: "success", data: null });
  })
);
