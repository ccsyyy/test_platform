import { mysqlPool } from "../db/mysql.js";
import type { AuthUser } from "./auth.js";
import { HttpError } from "./error.js";

export type ProjectRole = "project_admin" | "test_lead" | "tester" | "viewer";

export type ProjectAction =
  | "view"
  | "manage_settings"
  | "manage_members"
  | "record"
  | "materialize_recording"
  | "edit_elements"
  | "delete_elements"
  | "edit_cases"
  | "execute_cases"
  | "delete_reports";

const rolePermissions: Record<ProjectRole, Set<ProjectAction>> = {
  project_admin: new Set([
    "view",
    "manage_settings",
    "manage_members",
    "record",
    "materialize_recording",
    "edit_elements",
    "delete_elements",
    "edit_cases",
    "execute_cases",
    "delete_reports"
  ]),
  test_lead: new Set([
    "view",
    "record",
    "materialize_recording",
    "edit_elements",
    "delete_elements",
    "edit_cases",
    "execute_cases",
    "delete_reports"
  ]),
  tester: new Set([
    "view",
    "record",
    "materialize_recording",
    "edit_elements",
    "edit_cases",
    "execute_cases"
  ]),
  viewer: new Set(["view"])
};

export interface ProjectAccess {
  projectRole: ProjectRole;
  status: "active";
}

export function isSystemAdmin(user: AuthUser) {
  return user.roleCode === "admin";
}

export async function getProjectMembership(projectId: number, userId: number) {
  const [rows] = await mysqlPool.query(
    `
    SELECT id, project_role AS projectRole, status
    FROM tp_project_member
    WHERE project_id = ? AND user_id = ?
    LIMIT 1
    `,
    [projectId, userId]
  );
  return (rows as Array<{ id: number; projectRole: ProjectRole; status: string }>)[0] ?? null;
}

export async function assertProjectAccess(
  projectId: number,
  user: AuthUser,
  action: ProjectAction = "view"
): Promise<ProjectAccess> {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new HttpError(400, "项目 ID 无效");
  }

  const access: ProjectAccess = isSystemAdmin(user)
    ? { projectRole: "project_admin", status: "active" }
    : await resolveMemberAccess(projectId, user.id);

  if (!rolePermissions[access.projectRole].has(action)) {
    throw new HttpError(403, "项目权限不足");
  }

  return access;
}

async function resolveMemberAccess(projectId: number, userId: number): Promise<ProjectAccess> {
  const membership = await getProjectMembership(projectId, userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(403, "无权访问该项目");
  }
  if (!rolePermissions[membership.projectRole]) {
    throw new HttpError(403, "项目角色无效");
  }
  await mysqlPool.query(
    "UPDATE tp_project_member SET last_active_at = NOW(3) WHERE project_id = ? AND user_id = ?",
    [projectId, userId]
  );
  return {
    projectRole: membership.projectRole,
    status: "active"
  };
}

export async function getProjectIdByRecordingSession(sessionNo: string) {
  const [rows] = await mysqlPool.query(
    "SELECT project_id AS projectId FROM tp_recording_session WHERE session_no = ? LIMIT 1",
    [sessionNo]
  );
  const row = (rows as Array<{ projectId: number }>)[0];
  return row?.projectId ?? null;
}

export async function getProjectIdByCase(caseId: number) {
  const [rows] = await mysqlPool.query(
    "SELECT project_id AS projectId FROM tp_test_case WHERE id = ? LIMIT 1",
    [caseId]
  );
  const row = (rows as Array<{ projectId: number }>)[0];
  return row?.projectId ?? null;
}

export async function getProjectIdByJob(jobNo: string) {
  const [rows] = await mysqlPool.query(
    "SELECT project_id AS projectId FROM tp_execution_job WHERE job_no = ? LIMIT 1",
    [jobNo]
  );
  const row = (rows as Array<{ projectId: number }>)[0];
  return row?.projectId ?? null;
}
