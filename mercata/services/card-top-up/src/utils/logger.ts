export function logInfo(context: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  console.log(`${ts} [INFO] ${context}: ${message}`, data ?? "");
}

export function logError(context: string, error: Error | string, data?: unknown): void {
  const ts = new Date().toISOString();
  const msg = typeof error === "string" ? error : (error as Error).message;
  console.error(`${ts} [ERROR] ${context}: ${msg}`, data ?? "");
}
