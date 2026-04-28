import http from "node:http";
import { z } from "zod";
import { createRecordingSession, stopRecordingSession } from "./api.js";
import { startRecorder, type RecorderHandle } from "./recorder.js";

const port = Number(process.env.AGENT_PORT ?? 37665);
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

const startSchema = z.object({
  apiBaseUrl: z.string().url().default("http://localhost:3000"),
  token: z.string().min(1),
  projectId: z.number().int().positive(),
  environmentId: z.number().int().positive().optional(),
  startUrl: z.string().url(),
  browser: z.enum(["chrome", "edge", "chromium"]).default("chrome"),
  mode: z.enum(["record", "pick"]).default("record"),
  headless: z.boolean().default(false),
  autoDemo: z.boolean().default(false)
});

function allowedOrigins(): Set<string> {
  const configured = String(process.env.AGENT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

const corsOrigins = allowedOrigins();

function requestOrigin(request: http.IncomingMessage): string | null {
  const value = request.headers.origin;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isAllowedOrigin(origin: string | null): boolean {
  return !origin || corsOrigins.has(origin);
}

function send(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  status: number,
  body: unknown
): void {
  const origin = requestOrigin(request);
  if (origin && corsOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
  }
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function readBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const activeSessions = new Map<string, RecorderHandle>();

function activeSessionList() {
  return Array.from(activeSessions.keys());
}

const server = http.createServer(async (request, response) => {
  const origin = requestOrigin(request);
  if (!isAllowedOrigin(origin)) {
    send(request, response, 403, {
      code: 403,
      message: "origin not allowed",
      data: null
    });
    return;
  }

  if (request.method === "OPTIONS") {
    send(request, response, 204, null);
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      send(request, response, 200, {
        code: 200,
        message: "ok",
        data: {
          status: "online",
          activeSessions: activeSessions.size,
          sessions: activeSessionList()
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/start-recording") {
      const body = startSchema.parse(await readBody(request));
      const sessionNo = await createRecordingSession(body.token, {
        apiBaseUrl: body.apiBaseUrl,
        projectId: body.projectId,
        environmentId: body.environmentId,
        startUrl: body.startUrl,
        browser: body.browser,
        mode: body.mode
      });
      const handle = await startRecorder({
        apiBaseUrl: body.apiBaseUrl,
        token: body.token,
        sessionNo,
        startUrl: body.startUrl,
        environmentId: body.environmentId,
        browser: body.browser,
        headless: body.headless,
        autoDemo: body.autoDemo
      });
      activeSessions.set(sessionNo, handle);
      void handle.done
        .catch((error) => {
          console.error(`Recording failed: ${sessionNo}`, error);
        })
        .finally(async () => {
          activeSessions.delete(sessionNo);
          await stopRecordingSession(body.apiBaseUrl, body.token, sessionNo).catch((error) => {
            console.error(`Sync recording stop failed: ${sessionNo}`, error);
          });
        });

      send(request, response, 201, {
        code: 201,
        message: "created",
        data: { sessionNo }
      });
      return;
    }

    const stopMatch = url.pathname.match(/^\/recordings\/([^/]+)\/stop$/);
    if (request.method === "POST" && stopMatch) {
      const sessionNo = decodeURIComponent(stopMatch[1]);
      const handle = activeSessions.get(sessionNo);
      if (!handle) {
        send(request, response, 404, {
          code: 404,
          message: "recording session is not active",
          data: {
            sessionNo,
            activeSessions: activeSessionList()
          }
        });
        return;
      }
      await handle.stop();
      activeSessions.delete(sessionNo);
      const body = startSchema
        .partial()
        .pick({ apiBaseUrl: true, token: true })
        .parse(await readBody(request).catch(() => ({})));
      if (body.apiBaseUrl && body.token) {
        await stopRecordingSession(body.apiBaseUrl, body.token, sessionNo).catch((error) => {
          console.error(`Sync recording stop failed: ${sessionNo}`, error);
        });
      }
      send(request, response, 200, {
        code: 200,
        message: "stopped",
        data: {
          sessionNo,
          activeSessions: activeSessionList()
        }
      });
      return;
    }

    send(request, response, 404, { code: 404, message: "not found", data: null });
  } catch (error) {
    send(request, response, 400, {
      code: 400,
      message: error instanceof Error ? error.message : String(error),
      data: null
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Test Platform Agent listening on http://127.0.0.1:${port}`);
});
