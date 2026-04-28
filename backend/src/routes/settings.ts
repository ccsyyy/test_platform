import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { assertProjectAccess } from "../middleware/projectAccess.js";
import { getProjectSettings, saveProjectSettings } from "../services/projectSettings.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

const projectSettingsUpdateSchema = z
  .object({
    execution: z
      .object({
        defaultBrowser: z.enum(["chromium", "chrome", "edge"]).optional(),
        defaultHeadless: z.boolean().optional(),
        defaultRetries: z.number().int().min(0).max(5).optional(),
        defaultTimeoutMs: z.number().int().min(1000).max(300000).optional(),
        defaultScreenshot: z.boolean().optional(),
        defaultVideo: z.boolean().optional(),
        defaultTrace: z.boolean().optional(),
        reportRetentionDays: z.number().int().min(1).max(3650).optional(),
        logRetentionDays: z.number().int().min(1).max(3650).optional()
      })
      .partial()
      .optional(),
    agent: z
      .object({
        baseUrl: z.string().max(500).optional(),
        healthPath: z.string().max(200).optional(),
        checkBeforeRecording: z.boolean().optional(),
        autoCheckOnLoad: z.boolean().optional()
      })
      .partial()
      .optional()
  })
  .refine(
    (value) =>
      Boolean(value.execution && Object.keys(value.execution).length > 0) ||
      Boolean(value.agent && Object.keys(value.agent).length > 0),
    "Missing settings fields"
  );

settingsRouter.get(
  "/projects/:projectId/settings",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    const settings = await getProjectSettings(projectId);
    response.json({
      code: 200,
      message: "success",
      data: settings
    });
  })
);

settingsRouter.patch(
  "/projects/:projectId/settings",
  asyncHandler(async (request, response) => {
    const projectId = Number(request.params.projectId);
    await assertProjectAccess(projectId, request.user!, "manage_settings");
    const body = projectSettingsUpdateSchema.parse(request.body ?? {});
    const settings = await saveProjectSettings(projectId, body);
    response.json({
      code: 200,
      message: "success",
      data: settings
    });
  })
);
