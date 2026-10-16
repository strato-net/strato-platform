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

const signedRequest = (control: any, authorization: string) => {
  let status = 200;
  let next = false;
  control({ headers: { authorization }, socket: { remoteAddress: "runtime" } } as any,
    { setHeader: () => {}, status: (code: number) => { status = code; return { json: () => {} }; } } as any,
    () => { next = true; });
  return { status, next };
};

test("verifier accepts only fresh signed access for its own URL and chain from the runtime access address", async () => {
  const { Wallet } = await import("ethers");
  const { VERIFIER_ACCESS_DOMAIN, VERIFIER_ACCESS_TYPES, encodeVerifierAccessToken } = await import("../config/verifierAccess");
  const runtime = Wallet.createRandom();
  const other = Wallet.createRandom();
  const nowMs = 1_800_000_000_000;
  const now = Math.floor(nowMs / 1000);
  const verifierUrl = "https://sepolia.verifier.example";
  const token = async (grant: { verifier: string; chainId: string; expiresAt: number }, signer = runtime) =>
    `Bearer ${encodeVerifierAccessToken(grant, await signer.signTypedData(VERIFIER_ACCESS_DOMAIN, VERIFIER_ACCESS_TYPES, grant))}`;
  const control = verifierAccessControl(
    { signed: { runtimeAccessAddress: runtime.address, verifierUrl: `${verifierUrl}/`, chainId: 11155111n } },
    () => nowMs,
  );
  const valid = { verifier: verifierUrl, chainId: "11155111", expiresAt: now + 300 };
  assert.equal(signedRequest(control, await token(valid)).next, true);
  assert.equal(signedRequest(control, await token({ ...valid, expiresAt: now - 61 })).status, 401, "expired");
  assert.equal(signedRequest(control, await token({ ...valid, expiresAt: now + 361 })).status, 401, "lifetime too long");
  assert.equal(signedRequest(control, await token({ ...valid, verifier: "https://other.verifier.example" })).status, 401, "other verifier");
  assert.equal(signedRequest(control, await token({ ...valid, chainId: "84532" })).status, 401, "other chain");
  assert.equal(signedRequest(control, await token(valid, other)).status, 401, "other signer");
  const tampered = (await token(valid)).replace(/\.(0x[0-9a-f]+)$/, (_m, sig: string) => `.${sig.slice(0, -2)}00`);
  assert.equal(signedRequest(control, tampered).status, 401, "tampered signature");
  assert.equal(signedRequest(control, "Bearer eab-access-v1.not-json.0x00").status, 401, "malformed");
  assert.equal(signedRequest(control, `Bearer ${"s".repeat(32)}`).status, 401, "no legacy token configured");
});

test("during migration a verifier accepts both the legacy token and signed access", async () => {
  const { Wallet } = await import("ethers");
  const { VERIFIER_ACCESS_DOMAIN, VERIFIER_ACCESS_TYPES, encodeVerifierAccessToken } = await import("../config/verifierAccess");
  const runtime = Wallet.createRandom();
  const nowMs = 1_800_000_000_000;
  const grant = { verifier: "https://base-sepolia.verifier.example", chainId: "84532", expiresAt: Math.floor(nowMs / 1000) + 300 };
  const control = verifierAccessControl({
    token: "s".repeat(32),
    signed: { runtimeAccessAddress: runtime.address, verifierUrl: grant.verifier, chainId: 84532n },
  }, () => nowMs);
  const signed = encodeVerifierAccessToken(grant, await runtime.signTypedData(VERIFIER_ACCESS_DOMAIN, VERIFIER_ACCESS_TYPES, grant));
  assert.equal(signedRequest(control, `Bearer ${"s".repeat(32)}`).next, true);
  assert.equal(signedRequest(control, `Bearer ${signed}`).next, true);
  assert.equal(signedRequest(control, "Bearer wrong").status, 401);
});
