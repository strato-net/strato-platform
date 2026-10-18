import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import { verifySignedVerifierAccess } from "../signer/accessControl";
import {
  clearVerifierAccessCache,
  getRuntimeAccessKmsConfig,
  verifierAuthorizationHeader,
} from "./verifierAccessToken";

const setAccess = (values: Record<string, string | undefined>) => {
  for (const name of ["RUNTIME_ACCESS_ADDRESS", "RUNTIME_ACCESS_KMS_KEY_ID", "RUNTIME_ACCESS_KMS_REGION"]) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  clearVerifierAccessCache();
};

test("without the runtime access key the runtime cannot call verifiers", async () => {
  setAccess({});
  assert.throws(() => getRuntimeAccessKmsConfig(),
    /runtime access key is not configured \(RUNTIME_ACCESS_ADDRESS, RUNTIME_ACCESS_KMS_KEY_ID, RUNTIME_ACCESS_KMS_REGION not set\)/);
  await assert.rejects(verifierAuthorizationHeader("https://v1.example", 1), /runtime access key is not configured/);
});

test("partial or invalid runtime access key configuration is refused", () => {
  setAccess({ RUNTIME_ACCESS_KMS_KEY_ID: "arn:aws:kms:us-east-1:111111111111:key/abc" });
  assert.throws(() => getRuntimeAccessKmsConfig(), /\(RUNTIME_ACCESS_ADDRESS, RUNTIME_ACCESS_KMS_REGION not set\)/);
  setAccess({ RUNTIME_ACCESS_ADDRESS: "0x1234", RUNTIME_ACCESS_KMS_KEY_ID: "key", RUNTIME_ACCESS_KMS_REGION: "us-east-1" });
  assert.throws(() => getRuntimeAccessKmsConfig(), /RUNTIME_ACCESS_ADDRESS must be a valid address/);
  setAccess({});
});

test("with the runtime access key the runtime signs a short-lived token per verifier and reuses it", async () => {
  const runtime = Wallet.createRandom();
  setAccess({ RUNTIME_ACCESS_ADDRESS: runtime.address, RUNTIME_ACCESS_KMS_KEY_ID: "key", RUNTIME_ACCESS_KMS_REGION: "us-east-1" });
  let signatures = 0;
  const sign = async (_config: any, domain: any, types: any, value: any) => { signatures++; return runtime.signTypedData(domain, types, value); };
  let nowMs = 1_800_000_000_000;
  const now = () => nowMs;
  assert.deepEqual(getRuntimeAccessKmsConfig(), { address: runtime.address, keyId: "key", region: "us-east-1" });
  const first = await verifierAuthorizationHeader("https://Sepolia.Verifier.example/", 11155111n, { now, sign });
  const signed = { runtimeAccessAddress: runtime.address, verifierUrl: "https://sepolia.verifier.example", chainId: 11155111n };
  assert.equal(verifySignedVerifierAccess(first.Authorization, signed, nowMs), true);
  assert.equal(verifySignedVerifierAccess(first.Authorization, { ...signed, verifierUrl: "https://other.example" }, nowMs), false);
  nowMs += 200_000;
  assert.deepEqual(await verifierAuthorizationHeader("https://sepolia.verifier.example", 11155111, { now, sign }), first);
  assert.equal(signatures, 1, "cached while more than a minute remains");
  nowMs += 60_000;
  const renewed = await verifierAuthorizationHeader("https://sepolia.verifier.example", 11155111, { now, sign });
  assert.notDeepEqual(renewed, first);
  assert.equal(signatures, 2);
  assert.equal(verifySignedVerifierAccess(first.Authorization, signed, nowMs + 200_000), false, "the old token expires");
  await verifierAuthorizationHeader("https://base-sepolia.verifier.example", 84532, { now, sign });
  assert.equal(signatures, 3, "one token per verifier");
  setAccess({});
});
