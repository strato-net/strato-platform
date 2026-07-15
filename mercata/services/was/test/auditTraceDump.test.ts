/// <reference types="node" />

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WithdrawalAuditTrace } from "@mercata/shared-types";
import { dumpAuditTrace } from "../src/auditTraceDump";

const trace = (): WithdrawalAuditTrace => ({
  status: "complete",
  decision: "MANUAL_REVIEW",
  riskLevel: "medium",
  withdrawal: {
    routeType: "standard",
    withdrawalId: "1",
    bridgeStatus: "2",
    stratoSender: "3333333333333333333333333333333333333333",
    stratoToken: "4444444444444444444444444444444444444444",
    stratoTokenAmount: "100",
    externalChainId: "1",
    externalRecipient: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
  coverage: { clean: "0", tainted: "0", unknown: "100" },
  summary: ["Trace summary"],
  traceTree: {
    id: "root",
    type: "withdrawal",
    label: "TooLarge",
    result: "unknown",
    explanation: "",
    evidence: {},
    children: [],
  },
  updatedAt: "2026-07-09T15:29:56.773Z",
});

test("dumpAuditTrace writes compact fallback when full trace serialization fails", () => {
  const dumpDir = mkdtempSync(join(tmpdir(), "was-audit-traces-"));
  const originalStringify = JSON.stringify;
  JSON.stringify = ((value, replacer, space) => {
    if (value?.trace?.traceTree?.label === "TooLarge") {
      throw new RangeError("Invalid string length");
    }
    return originalStringify(value, replacer as never, space);
  }) as typeof JSON.stringify;

  try {
    dumpAuditTrace(
      dumpDir,
      {
        routeType: "standard",
        withdrawalId: "1",
        bridgeStatus: "2",
        timestamp: "",
        maxDepth: 5,
      },
      trace(),
    );

    const files = readdirSync(dumpDir).sort();
    assert.equal(files.includes("manifest.jsonl"), true);
    const summaryFile = files.find((file) => file.endsWith("-summary.json"));
    assert.ok(summaryFile);

    const summary = JSON.parse(readFileSync(join(dumpDir, summaryFile), "utf8"));
    assert.equal(summary.omitted, "Full trace dump exceeded the JSON serialization limit.");
    assert.equal(summary.trace.traceTree, undefined);

    const manifestEntry = JSON.parse(
      readFileSync(join(dumpDir, "manifest.jsonl"), "utf8"),
    );
    assert.equal(manifestEntry.fullDumpFailed, true);
    assert.equal(manifestEntry.error, "Invalid string length");
  } finally {
    JSON.stringify = originalStringify;
    rmSync(dumpDir, { recursive: true, force: true });
  }
});
