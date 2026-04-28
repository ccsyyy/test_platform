import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { assertProjectAccess } from "../middleware/projectAccess.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  artifactFileExists,
  getArtifactRecord,
  resolveArtifactFilePath
} from "../services/artifacts.js";

export const artifactsRouter = Router();

const artifactQuerySchema = z.object({
  mode: z.enum(["inline", "download"]).default("download")
});

const INLINE_ARTIFACT_TYPES = new Set(["screenshot", "video"]);

function safeFileName(fileName: string | null | undefined, fallback: string): string {
  return path.basename(String(fileName || fallback)).replace(/["\\\r\n]/g, "_");
}

function buildContentDisposition(mode: "inline" | "attachment", fileName: string): string {
  return `${mode}; filename="${fileName}"`;
}

artifactsRouter.use(requireAuth);

artifactsRouter.get(
  "/artifacts/:artifactId/content",
  asyncHandler(async (request, response) => {
    const artifactId = Number(request.params.artifactId);
    if (!Number.isInteger(artifactId) || artifactId <= 0) {
      throw new HttpError(400, "Invalid artifact id");
    }

    const artifact = await getArtifactRecord(artifactId);
    if (!artifact) {
      throw new HttpError(404, "Artifact not found");
    }

    await assertProjectAccess(artifact.projectId, request.user!);

    const filePath = resolveArtifactFilePath(artifact.storagePath);
    if (!filePath || !(await artifactFileExists(filePath))) {
      throw new HttpError(404, "Artifact file not found");
    }

    const { mode } = artifactQuerySchema.parse({ mode: request.query.mode });
    const dispositionMode =
      mode === "inline" && INLINE_ARTIFACT_TYPES.has(artifact.artifactType) ? "inline" : "attachment";
    const fileName = safeFileName(
      artifact.fileName,
      `${artifact.jobNo || `artifact-${artifact.id}`}-${artifact.artifactType}`
    );

    if (artifact.contentType) {
      response.type(artifact.contentType);
    }
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Content-Disposition", buildContentDisposition(dispositionMode, fileName));
    response.sendFile(filePath);
  })
);
