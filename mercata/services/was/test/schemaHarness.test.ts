/// <reference types="node" />

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const wasRoot = resolve(__dirname, "..");
const mercataRoot = resolve(wasRoot, "../..");
const schemaRoot = join(
  mercataRoot,
  "backend/src/api/services/withdrawalAuditSchemas",
);
const snapshotDir = join(
  wasRoot,
  "test/fixtures/schema-snapshot/current",
);
const srcRoot = join(wasRoot, "src");

const readJson = <T = any>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8"));

const eventSchema = readJson(join(schemaRoot, "event.json"));
const schemaIndex = readJson(join(schemaRoot, "index.json"));

const requiredEventFields = eventSchema.safeSelect as string[];
const unsupportedEventColumns = Object.keys(eventSchema.knownMissingColumns);

const assertHasFields = (
  row: Record<string, unknown>,
  fields: string[],
  label: string,
) => {
  for (const field of fields) {
    assert.ok(field in row, `${label} missing field ${field}`);
  }
};

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });

const readSnapshotManifest = (): any | null => {
  const manifestPath = join(snapshotDir, "manifest.json");
  return existsSync(manifestPath) ? readJson(manifestPath) : null;
};

test("schema index includes all Module 1 schema files", () => {
  assert.deepEqual(schemaIndex.schemas.sort(), [
    "event.json",
    "mercataBridge.assets.json",
    "mercataBridge.state.json",
    "mercataBridge.withdrawals.json",
    "stratoNativeBridge.assets.json",
    "stratoNativeBridge.state.json",
    "stratoNativeBridge.withdrawals.json",
  ]);
});

test("generated schema snapshot has one file per WAS target", (t) => {
  const manifest = readSnapshotManifest();
  if (!manifest) {
    t.skip("run npm run schema:snapshot to generate per-target snapshot files");
    return;
  }

  assertHasFields(
    manifest,
    ["generatedAt", "nodeUrlHost", "sampleLimit", "targets"],
    "schema snapshot manifest",
  );
  assert.ok(Array.isArray(manifest.targets), "manifest.targets must be an array");

  const targetNames = manifest.targets.map((target: any) => target.name);
  for (const name of [
    "mercataBridge.withdrawals",
    "stratoNativeBridge.withdrawals",
    "mercataBridge.state",
    "stratoNativeBridge.state",
    "mercataBridge.assets",
    "stratoNativeBridge.assets",
    "event.generic",
  ]) {
    assert.ok(targetNames.includes(name), `snapshot missing target ${name}`);
  }

  for (const target of manifest.targets) {
    assertHasFields(target, ["name", "table", "file", "rowCount"], target.name);
    const targetPath = join(snapshotDir, target.file);
    assert.ok(existsSync(targetPath), `snapshot target file missing: ${target.file}`);
    const targetSnapshot = readJson(targetPath);
    assert.equal(targetSnapshot.name, target.name);
    assert.equal(targetSnapshot.table, target.table);
  }
});

test("generated event snapshots use safe event columns", (t) => {
  const manifest = readSnapshotManifest();
  if (!manifest) {
    t.skip("run npm run schema:snapshot to generate per-target snapshot files");
    return;
  }

  const eventTargets = manifest.targets
    .filter((target: any) => target.table === "/event" && target.rowCount > 0)
    .map((target: any) => readJson(join(snapshotDir, target.file)));

  for (const target of eventTargets) {
    for (const row of target.sampleRows) {
      assertHasFields(row, requiredEventFields, target.name);
    }
  }
});

test("WAS source does not select unsupported event ordering columns", () => {
  const source = listSourceFiles(srcRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  for (const column of unsupportedEventColumns) {
    assert.equal(
      source.includes(column),
      false,
      `source must not reference unsupported event column ${column}`,
    );
  }
});
