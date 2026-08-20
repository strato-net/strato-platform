import fs from "fs";
import path from "path";

let logsDir: string | null = null;

export const initFileLogging = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
  logsDir = dir;
};

const stamp = () => new Date().toISOString();

const write = (level: string, component: string, message: string, meta?: object) => {
  const line = `${stamp()} ${level.padEnd(5)} [${component}] ${message}${meta ? " " + JSON.stringify(meta) : ""}`;
  if (level === "ERROR") console.error(line);
  else console.log(line);
  if (logsDir) {
    const file = path.join(logsDir, `bot-${stamp().slice(0, 10)}.log`);
    fs.appendFile(file, line + "\n", () => {});
  }
};

export const log = {
  info: (component: string, message: string, meta?: object) => write("INFO", component, message, meta),
  warn: (component: string, message: string, meta?: object) => write("WARN", component, message, meta),
  error: (component: string, message: string, error?: unknown, meta?: object) =>
    write("ERROR", component, `${message}${error ? ": " + (error instanceof Error ? error.stack ?? error.message : String(error)) : ""}`, meta),
};

// Per-issue transcript files: agent conversations, tool output, CI logs
export const issueLog = (issueNumber: number, section: string, content: string): void => {
  if (!logsDir) return;
  const dir = path.join(logsDir, `issue-${issueNumber}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${section}.log`), `\n----- ${stamp()} -----\n${content}\n`);
};
