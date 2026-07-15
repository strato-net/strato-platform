/// <reference types="node" />

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveTraceOperationLogs } from "../src/debugCleanup";

test("archiveTraceOperationLogs moves existing trace logs into timestamped backup", () => {
  const root = mkdtempSync(join(tmpdir(), "was-trace-logs-"));
  const traceDir = join(root, "trace-operations");
  const backupsDir = join(traceDir, "backups");
  mkdirSync(backupsDir, { recursive: true });
  writeFileSync(join(traceDir, "trace-a.jsonl"), "{}\n");
  writeFileSync(join(traceDir, "trace-b.jsonl"), "{}\n");

  try {
    archiveTraceOperationLogs(traceDir);

    assert.deepEqual(readdirSync(traceDir).sort(), ["backups"]);
    const backups = readdirSync(backupsDir);
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(
      readdirSync(join(backupsDir, backups[0])).sort(),
      ["trace-a.jsonl", "trace-b.jsonl"],
    );
    assert.equal(existsSync(join(traceDir, "trace-a.jsonl")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
