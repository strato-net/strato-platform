import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getAddress } from "ethers";
import { serviceTokenAccessControl, signedVerifierAccessFromEnv, verifierAccessControl } from "./accessControl";

test("service token access rejects bearer mismatches and bounds authenticated and failed requests", () => {
  let now = 0;
  const control = serviceTokenAccessControl("s".repeat(32), () => now);
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
  assert.throws(() => serviceTokenAccessControl("short"), /at least 32/);
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
  const access = source.indexOf('app.use("/operations/reviews", serviceTokenAccessControl(process.env.DEPOSIT_OPERATIONS_TOKEN))');
  const read = source.indexOf('app.get("/operations/reviews/processing-issues"');
  assert.ok(access >= 0 && read > access);
  const nginx = readFileSync(resolve(__dirname, "../../nginx/nginx.tpl.conf"), "utf8");
  assert.match(nginx, /location = \/operations\/reviews\/processing-issues\s*\{\s*limit_except GET \{ deny all; \}/);
  let status = 0;
  serviceTokenAccessControl(undefined)({} as any, { status: (value: number) => { status = value; return { json() {} }; } } as any, () => assert.fail("unconfigured auth cannot allow access"));
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
    { runtimeAccessAddress: runtime.address, verifierUrl: `${verifierUrl}/`, chainId: 11155111n },
    () => nowMs,
  );
  const valid = { verifier: verifierUrl, chainId: "11155111", expiresAt: now + 300 };
  assert.equal(signedRequest(control, await token(valid)).next, true);
  assert.equal(signedRequest(control, await token({ ...valid, expiresAt: now - 61 })).status, 401, "expired");
  assert.equal(signedRequest(control, await token({ ...valid, expiresAt: now + 361 })).status, 401, "lifetime too long");
  assert.equal(signedRequest(control, await token({ ...valid, verifier: "https://other.verifier.example" })).status, 401, "other verifier");
  assert.equal(signedRequest(control, await token({ ...valid, chainId: "84532" })).status, 401, "other chain");
  assert.equal(signedRequest(control, await token(valid, other)).status, 401, "other signer");
  // Change r: replacing v alone can leave the same recovery id (0x00 normalizes to 27), so it is not always a tamper.
  const tampered = (await token(valid)).replace(/\.(0x[0-9a-f]+)$/, (_m, sig: string) => `.0x${sig[2] === "0" ? "1" : "0"}${sig.slice(3)}`);
  assert.equal(signedRequest(control, tampered).status, 401, "tampered signature");
  assert.equal(signedRequest(control, "Bearer eab-access-v1.not-json.0x00").status, 401, "malformed");
  assert.equal(signedRequest(control, `Bearer ${"s".repeat(32)}`).status, 401, "static bearer token");
});

test("verifier requires the runtime access address and its public URL, and ignores the legacy API token", () => {
  const runtime = "0x00000000000000000000000000000000000000aa";
  const env = { RUNTIME_ACCESS_ADDRESS: runtime, VERIFIER_PUBLIC_URL: "https://Sepolia.Verifier.example/" };
  const warnings: string[] = [];
  const warn = (message: string) => { warnings.push(message); };
  assert.deepEqual(signedVerifierAccessFromEnv(env, 11155111n, warn), {
    runtimeAccessAddress: getAddress(runtime),
    verifierUrl: "https://sepolia.verifier.example",
    chainId: 11155111n,
  });
  assert.deepEqual(warnings, []);
  assert.throws(() => signedVerifierAccessFromEnv({ ...env, RUNTIME_ACCESS_ADDRESS: "" }, 1n, warn), /RUNTIME_ACCESS_ADDRESS is required/);
  assert.throws(() => signedVerifierAccessFromEnv({ ...env, RUNTIME_ACCESS_ADDRESS: "0x1234" }, 1n, warn), /RUNTIME_ACCESS_ADDRESS must be a valid address/);
  assert.throws(() => signedVerifierAccessFromEnv({ ...env, VERIFIER_PUBLIC_URL: " " }, 1n, warn), /VERIFIER_PUBLIC_URL is required/);
  assert.throws(() => signedVerifierAccessFromEnv({ ...env, VERIFIER_PUBLIC_URL: "verifier.example" }, 1n, warn), /VERIFIER_PUBLIC_URL must be/);
  assert.throws(() => signedVerifierAccessFromEnv({ ...env, VERIFIER_PUBLIC_URL: "ftp://verifier.example" }, 1n, warn), /VERIFIER_PUBLIC_URL must be/);
  signedVerifierAccessFromEnv({ ...env, EXTERNAL_BRIDGE_VERIFIER_API_TOKEN: "s".repeat(32) }, 1n, warn);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /EXTERNAL_BRIDGE_VERIFIER_API_TOKEN is ignored/);
});
