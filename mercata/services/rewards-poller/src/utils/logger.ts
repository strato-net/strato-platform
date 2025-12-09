import { healthMonitor } from "./healthMonitor";

const SENSITIVE = [
  /api[_-]?key=[^&\s]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /Authorization:\s*[^\s]+/gi,
];

const redact = (v: unknown): unknown => {
  if (typeof v === "string") {
    return SENSITIVE.reduce((s, p) => s.replace(p, "***"), v);
  }
  if (v && typeof v === "object") {
    try {
      const json = JSON.stringify(v);
      return JSON.parse(SENSITIVE.reduce((s, p) => s.replace(p, "***"), json));
    } catch {
      return "[Unserializable]";
    }
  }
  return v;
};

const write = async (data: object, isError: boolean) => {
  const d = data as any;
  const dt = new Date(d.ts);
  const ts = `${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getDate().toString().padStart(2,'0')} ${dt.toTimeString().slice(0,8)}`;
  
  console[isError ? 'error' : 'log'](
    `\x1b[90m${ts}\x1b[0m \x1b[3${isError ? 1 : 6}m[${d.level?.toUpperCase()}]\x1b[0m ${d.context}: ${d.msg}`,
    d.data || ""
  );
  
  if (isError) {
    await healthMonitor.appendToErrorFile(data)
  }
};

export const logInfo = (context: string, message: string, data?: any) =>
  write(
    {
      ts: new Date().toISOString(),
      level: "info",
      context,
      msg: redact(message),
      data: redact(data),
    },
    false,
  ).catch(err => {
    console.error("CRITICAL: Failed to write the log. That is an unexpected server configuration error, so we exit(1):", err);
    process.exit(1);
  });

export const logError = (
  context: string,
  error: Error | string,
  data?: any,
) => {
  const e = typeof error === "string" ? { message: error } : error;
  const redactedMsg = redact(e.message) as string;
  const stack = "stack" in e ? e.stack : undefined;

  write(
    {
      ts: new Date().toISOString(),
      level: "error",
      context,
      msg: redactedMsg,
      stack: stack && redact(stack),
      data: redact(data),
    },
    true,
  ).catch(err => {
    console.error("CRITICAL: Failed to write the error log. That is an unexpected server configuration error, so we exit(1):", err);
    process.exit(1);
  });
};

