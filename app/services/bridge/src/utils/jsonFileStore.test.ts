import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { JsonFileStore } from "./jsonFileStore";

const tempFile = (name: string) =>
  path.join(mkdtempSync(path.join(os.tmpdir(), "json-store-")), name);

test("concurrent updates all persist and no temporary file is left behind", async () => {
  const file = tempFile("counts.json");
  const store = new JsonFileStore<Record<string, number>>(file, () => ({}));

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.update((data) => {
        data[`k${i}`] = i;
      }),
    ),
  );

  const onDisk = JSON.parse(readFileSync(file, "utf-8"));
  assert.equal(Object.keys(onDisk).length, 20);
  assert.deepEqual(readdirSync(path.dirname(file)), ["counts.json"]);

  // A fresh instance reads what the first one wrote
  const reopened = new JsonFileStore<Record<string, number>>(file, () => ({}));
  assert.equal((await reopened.read()).k19, 19);
});

test("a failed update leaves the stored document unchanged", async () => {
  const file = tempFile("doc.json");
  const store = new JsonFileStore<Record<string, number>>(file, () => ({}));
  await store.update((data) => {
    data.a = 1;
  });
  await assert.rejects(() =>
    store.update((data) => {
      data.a = 2;
      throw new Error("boom");
    }),
  );
  await store.update((data) => {
    data.b = 3;
  });
  assert.deepEqual(await store.read(), { a: 1, b: 3 });
});

test("a corrupt file is refused unless the store opts into starting empty", async () => {
  const file = tempFile("corrupt.json");
  writeFileSync(file, "{not json");

  const strict = new JsonFileStore<Record<string, number>>(file, () => ({}));
  await assert.rejects(() => strict.read(), /not valid JSON/);

  const lenient = new JsonFileStore<Record<string, number>>(file, () => ({}), "empty");
  assert.deepEqual(await lenient.read(), {});
});
