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

test("processing records are behind operations authentication and a read-only nginx route", () => {
  const source = readFileSync(resolve(__dirname, "../../src/index.ts"), "utf8");
  const access = source.indexOf('app.use("/operations/reviews", verifierAccessControl(process.env.DEPOSIT_OPERATIONS_TOKEN))');
  const read = source.indexOf('app.get("/operations/reviews/processing-issues"');
  assert.ok(access >= 0 && read > access);
  const nginx = readFileSync(resolve(__dirname, "../../nginx/nginx.tpl.conf"), "utf8");
  assert.match(nginx, /location = \/operations\/reviews\/processing-issues\s*\{\s*limit_except GET \{ deny all; \}/);
  let status = 0;
  verifierAccessControl(undefined)({} as any, { status: (value: number) => { status = value; return { json() {} }; } } as any, () => assert.fail("unconfigured auth cannot allow access"));
  assert.equal(status, 503);
});
