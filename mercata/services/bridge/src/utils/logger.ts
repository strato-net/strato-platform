import { createWriteStream } from "fs";
import path from "path";
import { ERROR_FILE_NAME } from "../config";
import { healthMonitor } from "./healthMonitor";

const errorFile = createWriteStream(path.join(process.cwd(), ERROR_FILE_NAME), {
  flags: "a",
});

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
  const line = JSON.stringify(data) + "\n";
  (isError ? process.stderr : process.stdout).write(line);

  const d = data as any;
  console.log(
    `\x1b[3${isError ? 1 : 6}m[${d.level?.toUpperCase()}]\x1b[0m ${d.context}: ${d.msg}`,
    d.data || "",
  );

  if (isError) {
    errorFile.write(line) || errorFile.once("drain", () => {});
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
