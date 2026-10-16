import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import { verifySignedVerifierAccess } from "../signer/accessControl";
import {
  clearVerifierAccessCache,
  getRuntimeAccessKmsConfig,
  verifierAuthorizationHeader,
  verifierCredentialsError,
} from "./verifierAccessToken";

const setAccess = (values: Record<string, string | undefined>) => {
  for (const name of ["RUNTIME_ACCESS_ADDRESS", "RUNTIME_ACCESS_KMS_KEY_ID", "RUNTIME_ACCESS_KMS_REGION"]) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  clearVerifierAccessCache();
};

test("without the runtime access key the runtime sends the legacy bearer token", async () => {
  setAccess({});
  assert.deepEqual(await verifierAuthorizationHeader("https://v1.example", 1, "legacy-token"), { Authorization: "Bearer legacy-token" });
  await assert.rejects(verifierAuthorizationHeader("https://v1.example", 1, undefined), /No API token or runtime access key/);
  assert.match(String(verifierCredentialsError(["https://v1.example", "https://v2.example"], ["one"])), /one API token per verifier URL/);
  assert.equal(verifierCredentialsError(["https://v1.example"], ["one"]), undefined);
});

test("partial runtime access key configuration is refused", () => {
  setAccess({ RUNTIME_ACCESS_KMS_KEY_ID: "arn:aws:kms:us-east-1:111111111111:key/abc" });
  assert.throws(() => getRuntimeAccessKmsConfig(), /must be set together/);
  setAccess({});
});

test("with the runtime access key the runtime signs a short-lived token per verifier and reuses it", async () => {
  const runtime = Wallet.createRandom();
  setAccess({ RUNTIME_ACCESS_ADDRESS: runtime.address, RUNTIME_ACCESS_KMS_KEY_ID: "key", RUNTIME_ACCESS_KMS_REGION: "us-east-1" });
  let signatures = 0;
  const sign = async (_config: any, domain: any, types: any, value: any) => { signatures++; return runtime.signTypedData(domain, types, value); };
  let nowMs = 1_800_000_000_000;
  const now = () => nowMs;
  assert.equal(verifierCredentialsError(["https://v1.example", "https://v2.example"], []), undefined);
  const first = await verifierAuthorizationHeader("https://Sepolia.Verifier.example/", 11155111n, undefined, { now, sign });
  const signed = { runtimeAccessAddress: runtime.address, verifierUrl: "https://sepolia.verifier.example", chainId: 11155111n };
  assert.equal(verifySignedVerifierAccess(first.Authorization, signed, nowMs), true);
  assert.equal(verifySignedVerifierAccess(first.Authorization, { ...signed, verifierUrl: "https://other.example" }, nowMs), false);
  nowMs += 200_000;
  assert.deepEqual(await verifierAuthorizationHeader("https://sepolia.verifier.example", 11155111, "ignored", { now, sign }), first);
  assert.equal(signatures, 1, "cached while more than a minute remains");
  nowMs += 60_000;
  const renewed = await verifierAuthorizationHeader("https://sepolia.verifier.example", 11155111, undefined, { now, sign });
  assert.notDeepEqual(renewed, first);
  assert.equal(signatures, 2);
  assert.equal(verifySignedVerifierAccess(first.Authorization, signed, nowMs + 200_000), false, "the old token expires");
  await verifierAuthorizationHeader("https://base-sepolia.verifier.example", 84532, undefined, { now, sign });
  assert.equal(signatures, 3, "one token per verifier");
  setAccess({});
});
