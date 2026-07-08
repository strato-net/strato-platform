import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TRACE_OPERATION_LOG_DIR = process.env.WAS_TRACE_OPERATION_LOG_DIR;

const safeFilePart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);

export interface TraceOperationLogger {
  log(operation: string, data?: Record<string, unknown>): void;
}

export const createTraceOperationLogger = (
  traceId: string,
): TraceOperationLogger => {
  if (!TRACE_OPERATION_LOG_DIR) {
    return { log: () => undefined };
  }

  mkdirSync(TRACE_OPERATION_LOG_DIR, { recursive: true });
  const filePath = join(
    TRACE_OPERATION_LOG_DIR,
    `${Date.now()}-${safeFilePart(traceId)}.jsonl`,
  );

  return {
    log: (operation, data = {}) => {
      appendFileSync(
        filePath,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          traceId,
          operation,
          ...data,
        })}\n`,
      );
    },
  };
};
