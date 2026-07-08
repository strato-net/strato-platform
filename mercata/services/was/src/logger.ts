const SENSITIVE_PATTERNS = [
  /api[_-]?key=[^&\s]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /Authorization:\s*[^\s]+/gi,
];

const redact = (value: unknown): unknown => {
  if (typeof value === "string") {
    return SENSITIVE_PATTERNS.reduce(
      (current, pattern) => current.replace(pattern, "***"),
      value,
    );
  }

  if (!value || typeof value !== "object") return value;

  try {
    const json = JSON.stringify(value);
    const redacted = SENSITIVE_PATTERNS.reduce(
      (current, pattern) => current.replace(pattern, "***"),
      json,
    );
    return JSON.parse(redacted);
  } catch {
    return "[Unserializable]";
  }
};

const write = (
  level: "info" | "error",
  context: string,
  message: string,
  data?: unknown,
) => {
  const timestamp = new Date().toISOString();
  const payload = data === undefined ? "" : redact(data);
  console[level === "error" ? "error" : "log"](
    `${timestamp} [${level.toUpperCase()}] [WAS] ${context}: ${redact(message)}`,
    payload,
  );
};

export const logInfo = (context: string, message: string, data?: unknown) =>
  write("info", context, message, data);

export const logError = (
  context: string,
  error: Error | string,
  data?: unknown,
) => {
  const message = typeof error === "string" ? error : error.message;
  const stack = typeof error === "string" ? undefined : error.stack;
  write("error", context, message, { ...((data as object) || {}), stack });
};
