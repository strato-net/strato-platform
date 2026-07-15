import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WithdrawalAuditTrace } from "@mercata/shared-types";
import { buildAuditCacheKey } from "./auditCache";
import { logError } from "./logger";
import { AuditCacheKeyParts } from "./types";

const safeFilePart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._=-]/g, "_").slice(0, 180);

export const dumpAuditTrace = (
  dumpDir: string | undefined,
  keyParts: AuditCacheKeyParts,
  trace: WithdrawalAuditTrace,
) => {
  if (!dumpDir) return;

  const key = buildAuditCacheKey(keyParts);
  const dumpedAt = new Date().toISOString();
  const manifestEntry = {
    dumpedAt,
    cacheKey: key,
    routeType: trace.withdrawal.routeType,
    withdrawalId: trace.withdrawal.withdrawalId,
    bridgeStatus: trace.withdrawal.bridgeStatus,
    decision: trace.decision,
    riskLevel: trace.riskLevel,
    coverage: trace.coverage,
    summary: trace.summary,
  };

  try {
    mkdirSync(dumpDir, { recursive: true });
    const fileName = `${Date.now()}-${safeFilePart(key)}.json`;
    const filePath = join(dumpDir, fileName);
    const payload = {
      dumpedAt,
      cacheKey: key,
      keyParts,
      trace,
    };

    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
    appendFileSync(
      join(dumpDir, "manifest.jsonl"),
      `${JSON.stringify({ ...manifestEntry, file: filePath })}\n`,
    );
  } catch (error) {
    try {
      const fileName = `${Date.now()}-${safeFilePart(key)}-summary.json`;
      const filePath = join(dumpDir, fileName);
      const fallbackPayload = {
        dumpedAt,
        cacheKey: key,
        keyParts,
        trace: {
          status: trace.status,
          decision: trace.decision,
          riskLevel: trace.riskLevel,
          withdrawal: trace.withdrawal,
          maxDepth: trace.maxDepth,
          stoppedEarly: trace.stoppedEarly,
          coverage: trace.coverage,
          summary: trace.summary,
          updatedAt: trace.updatedAt,
        },
        omitted: "Full trace dump exceeded the JSON serialization limit.",
      };

      writeFileSync(filePath, `${JSON.stringify(fallbackPayload, null, 2)}\n`);
      appendFileSync(
        join(dumpDir, "manifest.jsonl"),
        `${JSON.stringify({
          ...manifestEntry,
          file: filePath,
          fullDumpFailed: true,
          error: error instanceof Error ? error.message : String(error),
        })}\n`,
      );
      logError("AuditTraceDump", error as Error, { cacheKey: key, fallback: filePath });
    } catch (fallbackError) {
      logError("AuditTraceDump", fallbackError as Error, {
        cacheKey: key,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
