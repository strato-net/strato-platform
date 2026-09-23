const assert = require("node:assert/strict");
const test = require("node:test");
const { ethers } = require("ethers");
const {
  normalizeConfig,
  buildOperations,
  getServiceExecutor,
  validateServiceSigners,
} = require("../scripts/lib/externalBridgeVaultPlan");
const {
  buildTransactionBuilderBatch,
} = require("../scripts/lib/depositRouterSafeOps");

const signerOneKey = `0x${"11".repeat(32)}`;
const signerTwoKey = `0x${"22".repeat(32)}`;
const executorKey = `0x${"33".repeat(32)}`;
const signerOne = new ethers.Wallet(signerOneKey).address;
const signerTwo = new ethers.Wallet(signerTwoKey).address;
const executor = new ethers.Wallet(executorKey).address;

function config(overrides = {}) {
  return normalizeConfig({
    sourceChainId: "6909499098523985262",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    chains: [{
      chainId: 11155111,
      safeAddress: "0x2222222222222222222222222222222222222222",
      guardianAddress: "0x8888888888888888888888888888888888888888",
      vaultAddress: "0x3333333333333333333333333333333333333333",
      depositRouterAddress: "0x4444444444444444444444444444444444444444",
      attestationSigners: [signerOne, signerTwo],
      disabledAttestationSigners: [
        "0x5555555555555555555555555555555555555555",
      ],
      attestationThreshold: 2,
      maxAuthorizationValiditySeconds: 1800,
      tokens: [
        {
          token: ethers.ZeroAddress,
          enabled: true,
          maxPerWithdrawal: "100",
          bucketCapacity: "1000",
          refillRate: "1",
          manualReviewThreshold: "50",
          migrateAmount: "500",
        },
        {
          token: "0x6666666666666666666666666666666666666666",
          enabled: true,
          maxPerWithdrawal: "200",
          bucketCapacity: "2000",
          refillRate: "1",
          manualReviewThreshold: "100",
          migrateAmount: "750",
        },
      ],
      ...overrides,
    }],
  });
}

test("builds governance, router, and explicit liquidity migration operations", () => {
  const normalized = config();
  const operations = buildOperations(normalized, normalized.chains[0]);

  assert.deepEqual(
    operations.configure.map(({ method }) => method),
    [
      "setSourceBridge",
      "setAttestationSigner",
      "setAttestationSigner",
      "setAttestationThreshold",
      "setAttestationSigner",
      "setMaxAuthorizationValiditySeconds",
      "setTokenPolicy",
      "setTokenPolicy",
    ],
  );
  assert.equal(operations.router[0].method, "setExternalBridgeVault");
  assert.deepEqual(
    operations.liquidity.map(({ method, value }) => [
      method,
      value.toString(),
    ]),
    [
      ["transferNative", "500"],
      ["transfer", "0"],
    ],
  );
  assert.equal(operations.liquidity[1].args[1], 750n);
});

test("validates independent signer addresses against the configured threshold", () => {
  const chain = config().chains[0];
  const valid = validateServiceSigners(chain, {
    CHAIN_11155111_VAULT_AUTHORIZATION_SIGNER_ADDRESSES: `${signerOne},${signerTwo}`,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS: executor,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID: "alias/eab-executor",
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION: "us-east-1",
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.missingSignerCount, 0);
  assert.equal(valid.executorConfigSource, "kms");

  const incomplete = validateServiceSigners(chain, {
    CHAIN_11155111_VAULT_AUTHORIZATION_SIGNER_ADDRESSES: signerOne,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS: executor,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID: "alias/eab-executor",
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION: "us-east-1",
  });
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.missingSignerCount, 1);
});

test("validates KMS-only executor config against the signer threshold", () => {
  const chain = config().chains[0];
  const valid = validateServiceSigners(chain, {
    CHAIN_11155111_VAULT_AUTHORIZATION_SIGNER_ADDRESSES: `${signerOne},${signerTwo}`,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS: executor,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID: "alias/eab-executor",
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION: "us-east-1",
  });

  assert.equal(valid.valid, true);
  assert.equal(valid.executorAddress, executor);
  assert.equal(valid.executorConfigSource, "kms");
});

test("rejects incomplete KMS executor config", () => {
  const result = getServiceExecutor(11155111, {
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID: "alias/eab-executor",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS",
    "CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION",
  ]);
});

test("rejects an executor that is also an attestation signer", () => {
  const result = validateServiceSigners(config().chains[0], {
    CHAIN_11155111_VAULT_AUTHORIZATION_SIGNER_ADDRESSES: `${signerOne},${signerTwo}`,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS: signerOne,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID: "alias/eab-executor",
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION: "us-east-1",
  });
  assert.equal(result.valid, false);
  assert.equal(result.executorIsSigner, true);
});

test("rejects a threshold above the configured signer count", () => {
  assert.throws(
    () => config({ attestationThreshold: 3 }),
    /attestationThreshold must be between 2 and the configured signer count/,
  );
});

test("builds standalone Safe Transaction Builder JSON", () => {
  const batch = buildTransactionBuilderBatch(
    11155111,
    "0x2222222222222222222222222222222222222222",
    [{
      to: "0x3333333333333333333333333333333333333333",
      value: "0",
      data: "0x1234",
      operation: 0,
    }],
    { name: "Test batch" },
  );

  assert.equal(batch.version, "1.0");
  assert.equal(batch.chainId, "11155111");
  assert.equal(batch.meta.name, "Test batch");
  assert.equal(
    batch.meta.createdFromSafeAddress,
    "0x2222222222222222222222222222222222222222",
  );
  assert.deepEqual(batch.transactions[0], {
    to: "0x3333333333333333333333333333333333333333",
    value: "0",
    data: "0x1234",
    contractMethod: null,
    contractInputsValues: null,
  });
});

test("rejects zero buckets, excessive refill rates, and withdrawals larger than capacity", () => {
  const token = { token: ethers.ZeroAddress, enabled: true, maxPerWithdrawal: "100",
    bucketCapacity: "1000", refillRate: "1", manualReviewThreshold: "50", migrateAmount: "0" };
  for (const invalid of [{ bucketCapacity: "0" }, { refillRate: "0" }, { refillRate: "1001" }, { maxPerWithdrawal: "1001" }]) {
    assert.throws(() => config({ tokens: [{ ...token, ...invalid }] }), /requires positive bucketCapacity\/refillRate/);
  }
  const legacy = { ...token, windowLimit: "1000", windowSeconds: "86400" };
  delete legacy.bucketCapacity;
  delete legacy.refillRate;
  assert.throws(() => config({ tokens: [legacy] }), /bucketCapacity/);
});

test("rejects a one-signer vault threshold", () => {
  assert.throws(() => config({ attestationThreshold: 1 }), /attestationThreshold/);
});
