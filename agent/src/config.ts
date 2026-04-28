import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  API_BASE_URL: z.string().url().default("http://localhost:3000"),
  USERNAME: z.string().min(1),
  PASSWORD: z.string().min(1),
  PROJECT_ID: z.coerce.number().int().positive(),
  ENVIRONMENT_ID: z.coerce.number().int().positive().optional(),
  START_URL: z.string().url(),
  BROWSER: z.enum(["chrome", "edge", "chromium"]).default("chrome"),
  MODE: z.enum(["record", "pick"]).default("record"),
  HEADLESS: z.coerce.boolean().default(false),
  AUTO_DEMO: z.coerce.boolean().default(false)
});

export const config = schema.parse(process.env);
