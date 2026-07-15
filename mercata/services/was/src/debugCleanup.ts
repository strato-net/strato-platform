import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { logInfo } from "./logger";
import { WasConfig } from "./types";

const removeDir = (path: string | undefined) => {
  if (!path) return;
  rmSync(path, { recursive: true, force: true });
  logInfo("DebugCleanup", "Cleared debug directory", { path });
};

const timestampFolderName = (): string =>
  new Date().toISOString().replace(/[:.]/g, "-");

export const archiveTraceOperationLogs = (path: string | undefined) => {
  if (!path || !existsSync(path)) return;

  const entries = readdirSync(path, { withFileTypes: true }).filter(
    (entry) => entry.name !== "backups",
  );
  if (!entries.length) return;

  const backupDir = join(path, "backups", timestampFolderName());
  mkdirSync(backupDir, { recursive: true });

  for (const entry of entries) {
    renameSync(join(path, entry.name), join(backupDir, entry.name));
  }

  logInfo("DebugCleanup", "Archived trace operation logs", {
    path,
    backupDir,
    files: entries.length,
  });
};

export const clearVolatileDebugOutputs = (config: WasConfig) => {
  removeDir(config.auditTraceDumpDir);
  archiveTraceOperationLogs(process.env.WAS_TRACE_OPERATION_LOG_DIR);

  const protocolDumpRoot = process.env.WAS_DEBUG_EVENT_DUMP_DIR;
  if (protocolDumpRoot) {
    removeDir(join(protocolDumpRoot, "protocol-event-association"));
    rmSync(join(protocolDumpRoot, "protocol-event-association-manifest.jsonl"), {
      force: true,
    });
    logInfo("DebugCleanup", "Cleared protocol association manifest", {
      path: join(protocolDumpRoot, "protocol-event-association-manifest.jsonl"),
    });
  }
};
