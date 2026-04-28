import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { artifactsRouter } from "./routes/artifacts.js";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { casesRouter } from "./routes/cases.js";
import { elementsRouter } from "./routes/elements.js";
import { executionRouter } from "./routes/execution.js";
import { healthRouter } from "./routes/health.js";
import { projectsRouter } from "./routes/projects.js";
import { recordingRouter } from "./routes/recording.js";
import { demoRouter } from "./routes/demo.js";
import { settingsRouter } from "./routes/settings.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

function allowedOrigins(): Set<string> {
  const configured = config.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

export function createApp() {
  const app = express();
  const corsOrigins = allowedOrigins();
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "connect-src": ["'self'", "http://127.0.0.1:37665", "http://localhost:37665"]
        }
      }
    })
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, corsOrigins.has(origin));
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: "10mb" }));

  app.use(express.static(publicDir));
  app.use(healthRouter);
  app.use(demoRouter);
  app.use("/api", authRouter);
  app.use("/api", artifactsRouter);
  app.use("/api", aiRouter);
  app.use("/api", projectsRouter);
  app.use("/api", casesRouter);
  app.use("/api", elementsRouter);
  app.use("/api", recordingRouter);
  app.use("/api", executionRouter);
  app.use("/api", settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
