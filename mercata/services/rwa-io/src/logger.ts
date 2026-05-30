const SERVICE = "RwaIoAdapter";

function ts(): string {
  return new Date().toISOString();
}

export function logInfo(message: string, data?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({ level: "info", service: SERVICE, ts: ts(), message, ...data })
  );
}

export function logError(message: string, error?: unknown, data?: Record<string, unknown>): void {
  const errMsg = error instanceof Error ? error.message : String(error ?? "");
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(
    JSON.stringify({ level: "error", service: SERVICE, ts: ts(), message, error: errMsg, stack, ...data })
  );
}
