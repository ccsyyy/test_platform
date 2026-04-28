import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CORS_ORIGIN: z.string().default(""),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().default(""),
  MYSQL_DATABASE: z.string().default("test_platform"),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_DISPLAY_NAME: z.string().optional(),
  AI_ENCRYPTION_SECRET: z.string().min(16).optional(),
  AI_DEFAULT_PROVIDER: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().optional(),
  AI_DEFAULT_BASE_URL: z.string().optional(),
  AI_DEFAULT_API_KEY: z.string().optional(),
  AI_DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000)
});

export const config = schema.parse(process.env);
