interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumberEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function request<T>(apiBaseUrl: string, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, apiBaseUrl), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || payload.code >= 400) {
    throw new Error(payload.message || `API request failed: ${response.status}`);
  }
  return payload.data;
}

export async function login(): Promise<string> {
  const data = await request<{ token: string }>(
    process.env.API_BASE_URL ?? "http://localhost:3000",
    "/api/auth/login",
    {
    method: "POST",
    body: JSON.stringify({
      username: requiredEnv("USERNAME"),
      password: requiredEnv("PASSWORD")
    })
    }
  );
  return data.token;
}

export interface RecordingSessionInput {
  apiBaseUrl?: string;
  projectId?: number;
  environmentId?: number;
  startUrl?: string;
  browser?: "chrome" | "edge" | "chromium";
  mode?: "record" | "pick";
}

export async function createRecordingSession(
  token: string,
  input: RecordingSessionInput = {}
): Promise<string> {
  const apiBaseUrl = input.apiBaseUrl ?? process.env.API_BASE_URL ?? "http://localhost:3000";
  const data = await request<{ sessionNo: string }>(apiBaseUrl, "/api/recording-sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      projectId: input.projectId ?? optionalNumberEnv("PROJECT_ID"),
      environmentId: input.environmentId ?? optionalNumberEnv("ENVIRONMENT_ID"),
      startUrl: input.startUrl ?? requiredEnv("START_URL"),
      browser: input.browser ?? process.env.BROWSER ?? "chrome",
      mode: input.mode ?? process.env.MODE ?? "record"
    })
  });
  return data.sessionNo;
}

export async function uploadRecordingEvent(
  apiBaseUrl: string,
  token: string,
  body: Record<string, unknown>
): Promise<void> {
  await request<null>(apiBaseUrl, "/api/recording-events", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

export async function stopRecordingSession(
  apiBaseUrl: string,
  token: string,
  sessionNo: string
): Promise<void> {
  await request<null>(apiBaseUrl, `/api/recording-sessions/${sessionNo}/stop`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`
    }
  });
}
