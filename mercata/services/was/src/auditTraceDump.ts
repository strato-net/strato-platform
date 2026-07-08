import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WithdrawalAuditTrace } from "@mercata/shared-types";
import { buildAuditCacheKey } from "./auditCache";
import { AuditCacheKeyParts } from "./types";

const safeFilePart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._=-]/g, "_").slice(0, 180);

export const dumpAuditTrace = (
  dumpDir: string | undefined,
  keyParts: AuditCacheKeyParts,
  trace: WithdrawalAuditTrace,
) => {
  if (!dumpDir) return;

  mkdirSync(dumpDir, { recursive: true });
  const key = buildAuditCacheKey(keyParts);
  const fileName = `${Date.now()}-${safeFilePart(key)}.json`;
  const filePath = join(dumpDir, fileName);
  const payload = {
    dumpedAt: new Date().toISOString(),
    cacheKey: key,
    keyParts,
    trace,
  };

  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  appendFileSync(
    join(dumpDir, "manifest.jsonl"),
    `${JSON.stringify({
      dumpedAt: payload.dumpedAt,
      file: filePath,
      cacheKey: key,
      routeType: trace.withdrawal.routeType,
      withdrawalId: trace.withdrawal.withdrawalId,
      bridgeStatus: trace.withdrawal.bridgeStatus,
      decision: trace.decision,
      riskLevel: trace.riskLevel,
      coverage: trace.coverage,
      summary: trace.summary,
    })}\n`,
  );
};
