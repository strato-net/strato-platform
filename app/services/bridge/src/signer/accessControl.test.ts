import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { verifierAccessControl } from "./accessControl";

test("verifier rejects bearer mismatches and bounds authenticated and failed requests", () => {
  let now = 0;
  const control = verifierAccessControl("s".repeat(32), () => now);
  const request = (token: string, peer = "one") => {
    let status = 200;
    let next = false;
    control({ headers: { authorization: token }, socket: { remoteAddress: peer } } as any,
      { setHeader: () => {}, status: (code: number) => { status = code; return { json: () => {} }; } } as any,
      () => { next = true; });
    return { status, next };
  };
  assert.equal(request(`Bearer ${"s".repeat(32)}!`).status, 401);
  for (let i = 1; i < 30; i++) assert.equal(request("Bearer bad").status, 401);
  assert.equal(request("Bearer bad").status, 429);
  assert.equal(request(`Bearer ${"s".repeat(32)}`).next, true, "failed attempts behind a shared proxy cannot block valid credentials");
  for (let i = 1; i < 120; i++) assert.equal(request(`Bearer ${"s".repeat(32)}`, "two").next, true);
  assert.equal(request(`Bearer ${"s".repeat(32)}`, "two").status, 429);
  now = 60_000;
  assert.equal(request(`Bearer ${"s".repeat(32)}`).next, true);
});

test("rejects weak bearer tokens", () => {
  assert.throws(() => verifierAccessControl("short"), /at least 32/);
});

test("health is public while verifier operations require bearer authentication", () => {
  const source = readFileSync(resolve(__dirname, "../../src/signer/index.ts"), "utf8");
  const health = source.indexOf('app.get("/health"');
  const accessControl = source.indexOf("app.use(verifierAccessControl");
  const signing = source.indexOf('app.post("/v1/sign-withdrawal"');
  assert.ok(health >= 0 && health < accessControl && accessControl < signing);
});
