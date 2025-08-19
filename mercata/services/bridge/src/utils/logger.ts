import { createWriteStream } from "fs";
import path from "path";
import { ERROR_FILE_NAME } from "../config";
import { healthMonitor } from "./healthMonitor";

const ERROR_FILE_PATH = path.join(process.cwd(), ERROR_FILE_NAME);

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

const write = (data: object, isError: boolean) => {
  const d = data as any;
  const dt = new Date(d.ts);
  const ts = `${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getDate().toString().padStart(2,'0')} ${dt.toTimeString().slice(0,8)}`;
  
  console.log(
    `\x1b[90m${ts}\x1b[0m \x1b[3${isError ? 1 : 6}m[${d.level?.toUpperCase()}]\x1b[0m ${d.context}: ${d.msg}`,
    d.data || ""
  );
  
  if (isError) {
    const errorFile = createWriteStream(ERROR_FILE_PATH, { flags: "a" });
    errorFile.write(JSON.stringify(data) + "\n") || errorFile.once("drain", () => {});
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
  );

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
  );

  try {
    healthMonitor.recordFailure(redactedMsg);
  } catch {}
};
