import { constants } from "node:fs";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { mysqlPool } from "../db/mysql.js";
import { config } from "../config.js";
import { getProjectSettings } from "./projectSettings.js";

const ARTIFACT_ROOT = path.resolve(process.cwd(), "artifacts");
const FINISHED_JOB_STATUSES = ["passed", "failed", "canceled", "timeout"];

export interface ArtifactRecord {
  id: number;
  projectId: number;
  jobId: number | null;
  jobNo: string | null;
  artifactType: string;
  storagePath: string;
  fileName: string | null;
  contentType: string | null;
}

interface ArtifactCleanupJobRow {
  jobId: number;
  jobNo: string | null;
  projectId: number;
  finishedAt: Date | string | null;
}

function isPathWithin(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sanitizeJobNo(jobNo: string | null | undefined): string | null {
  const normalized = String(jobNo || "").trim();
  if (!normalized) {
    return null;
  }
  return /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : null;
}

function toTimestamp(value: Date | string | null): number | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function artifactRootDir(): string {
  return ARTIFACT_ROOT;
}

export function resolveArtifactFilePath(storagePath: string | null | undefined): string | null {
  if (!storagePath) {
    return null;
  }
  const resolvedPath = path.resolve(storagePath);
  return isPathWithin(ARTIFACT_ROOT, resolvedPath) ? resolvedPath : null;
}

export async function artifactFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getArtifactRecord(artifactId: number): Promise<ArtifactRecord | null> {
  const [rows] = await mysqlPool.query(
    `
    SELECT a.id, a.project_id AS projectId, a.job_id AS jobId,
      j.job_no AS jobNo, a.artifact_type AS artifactType,
      a.storage_path AS storagePath, a.file_name AS fileName,
      a.content_type AS contentType
    FROM tp_artifact a
    LEFT JOIN tp_execution_job j ON j.id = a.job_id
    WHERE a.id = ?
    LIMIT 1
    `,
    [artifactId]
  );
  return (rows as ArtifactRecord[])[0] ?? null;
}

export async function removeArtifactDirectoryForJob(jobNo: string | null | undefined): Promise<void> {
  const safeJobNo = sanitizeJobNo(jobNo);
  if (!safeJobNo) {
    return;
  }
  const jobDir = path.join(ARTIFACT_ROOT, safeJobNo);
  if (!isPathWithin(ARTIFACT_ROOT, jobDir)) {
    return;
  }
  await rm(jobDir, { recursive: true, force: true });
}

export async function cleanupExpiredArtifacts(): Promise<{ jobs: number; artifacts: number }> {
  const [rows] = await mysqlPool.query(
    `
    SELECT DISTINCT j.id AS jobId, j.job_no AS jobNo, j.project_id AS projectId,
      COALESCE(j.finished_at, j.updated_at, j.created_at) AS finishedAt
    FROM tp_artifact a
    JOIN tp_execution_job j ON j.id = a.job_id
    WHERE j.job_no IS NOT NULL
      AND j.status IN (${FINISHED_JOB_STATUSES.map(() => "?").join(", ")})
    ORDER BY j.id ASC
    `,
    FINISHED_JOB_STATUSES
  );
  const jobs = rows as ArtifactCleanupJobRow[];
  if (!jobs.length) {
    return { jobs: 0, artifacts: 0 };
  }

  const retentionCache = new Map<number, number>();
  const expiredJobs: ArtifactCleanupJobRow[] = [];
  const now = Date.now();

  for (const job of jobs) {
    const finishedAt = toTimestamp(job.finishedAt);
    if (!finishedAt) {
      continue;
    }

    let retentionDays = retentionCache.get(job.projectId);
    if (retentionDays === undefined) {
      const settings = await getProjectSettings(job.projectId);
      retentionDays = Math.max(1, Number(settings.execution.reportRetentionDays || 30));
      retentionCache.set(job.projectId, retentionDays);
    }

    const expirationTime = finishedAt + retentionDays * 24 * 60 * 60 * 1000;
    if (expirationTime <= now) {
      expiredJobs.push(job);
    }
  }

  if (!expiredJobs.length) {
    return { jobs: 0, artifacts: 0 };
  }

  const jobIds = expiredJobs.map((job) => job.jobId);
  const [artifactRows] = await mysqlPool.query(
    `
    SELECT id, job_id AS jobId
    FROM tp_artifact
    WHERE job_id IN (?)
    `,
    [jobIds]
  );
  const artifacts = artifactRows as Array<{ id: number; jobId: number }>;
  const artifactIds = artifacts.map((artifact) => artifact.id);

  if (artifactIds.length) {
    await mysqlPool.query("UPDATE tp_report SET artifact_id = NULL WHERE artifact_id IN (?)", [artifactIds]);
  }
  await mysqlPool.query("DELETE FROM tp_artifact WHERE job_id IN (?)", [jobIds]);

  const expiredJobNos = Array.from(
    new Set(expiredJobs.map((job) => sanitizeJobNo(job.jobNo)).filter((jobNo): jobNo is string => Boolean(jobNo)))
  );
  await Promise.all(expiredJobNos.map((jobNo) => removeArtifactDirectoryForJob(jobNo)));

  return {
    jobs: expiredJobNos.length,
    artifacts: artifacts.length
  };
}

let retentionTimer: NodeJS.Timeout | null = null;
let retentionSweepRunning = false;

export function startArtifactRetentionScheduler(): void {
  if (retentionTimer) {
    return;
  }

  const runCleanup = async () => {
    if (retentionSweepRunning) {
      return;
    }
    retentionSweepRunning = true;
    try {
      const result = await cleanupExpiredArtifacts();
      if (result.jobs > 0 || result.artifacts > 0) {
        console.log(
          `Artifact retention cleanup removed ${result.artifacts} files across ${result.jobs} jobs`
        );
      }
    } catch (error) {
      console.error("Artifact retention cleanup failed", error);
    } finally {
      retentionSweepRunning = false;
    }
  };

  void runCleanup();
  retentionTimer = setInterval(() => {
    void runCleanup();
  }, config.RETENTION_SWEEP_INTERVAL_MS);
  retentionTimer.unref();
}
