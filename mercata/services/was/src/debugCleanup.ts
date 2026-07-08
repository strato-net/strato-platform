import { rmSync } from "node:fs";
import { join } from "node:path";
import { logInfo } from "./logger";
import { WasConfig } from "./types";

const removeDir = (path: string | undefined) => {
  if (!path) return;
  rmSync(path, { recursive: true, force: true });
  logInfo("DebugCleanup", "Cleared debug directory", { path });
};

export const clearVolatileDebugOutputs = (config: WasConfig) => {
  removeDir(config.auditTraceDumpDir);
  removeDir(process.env.WAS_TRACE_OPERATION_LOG_DIR);

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
