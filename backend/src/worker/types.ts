export interface ExecutionQueuePayload {
  jobNo: string;
  projectId: number;
  environmentId: number | null;
  browser: "chromium" | "chrome" | "edge";
  caseIds: number[];
  config: {
    headless: boolean;
    viewport?: {
      width: number;
      height: number;
    };
    retries: number;
    timeoutMs: number;
    screenshot: boolean;
    video: boolean;
    trace: boolean;
  };
}

export interface CaseStepRecord {
  id: number;
  caseId: number;
  stepOrder: number;
  stepName: string | null;
  action: string;
  elementId: number | null;
  stepDsl: Record<string, unknown>;
  locatorSnapshot: Record<string, unknown> | Array<Record<string, unknown>> | null;
  locatorType: string | null;
  locatorValue: string | null;
  locatorExpression: string | null;
  locatorId?: number | null;
  elementName?: string | null;
  pageName?: string | null;
  componentName?: string | null;
  elementAttributes?: Record<string, unknown> | null;
  locatorCandidates: Array<{
    id?: number;
    locatorType: string;
    locatorValue: string;
    locatorExpression: string | null;
    score?: number;
    isPrimary?: boolean;
    source?: string;
    status?: string;
    priority?: number;
    confidence?: number;
    successCount?: number;
    failedCount?: number;
  }>;
}
