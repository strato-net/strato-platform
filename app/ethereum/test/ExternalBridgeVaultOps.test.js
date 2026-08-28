const assert = require("node:assert/strict");
const test = require("node:test");
const { ethers } = require("ethers");
const {
  normalizeConfig,
  buildOperations,
  validateServiceSigners,
} = require("../scripts/lib/externalBridgeVaultPlan");

const signerOneKey = `0x${"11".repeat(32)}`;
const signerTwoKey = `0x${"22".repeat(32)}`;
const executorKey = `0x${"33".repeat(32)}`;
const signerOne = new ethers.Wallet(signerOneKey).address;
const signerTwo = new ethers.Wallet(signerTwoKey).address;

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
          windowLimit: "1000",
          windowSeconds: "86400",
          manualReviewThreshold: "50",
          migrateAmount: "500",
        },
        {
          token: "0x6666666666666666666666666666666666666666",
          enabled: true,
          maxPerWithdrawal: "200",
          windowLimit: "2000",
          windowSeconds: "86400",
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
    CHAIN_11155111_EXTERNAL_BRIDGE_SIGNER_ADDRESSES: `${signerOne},${signerTwo}`,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_PRIVATE_KEY: executorKey,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.missingSignerCount, 0);

  const incomplete = validateServiceSigners(chain, {
    CHAIN_11155111_EXTERNAL_BRIDGE_SIGNER_ADDRESSES: signerOne,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_PRIVATE_KEY: executorKey,
  });
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.missingSignerCount, 1);
});

test("rejects an executor that is also an attestation signer", () => {
  const result = validateServiceSigners(config().chains[0], {
    CHAIN_11155111_EXTERNAL_BRIDGE_SIGNER_ADDRESSES: `${signerOne},${signerTwo}`,
    CHAIN_11155111_EXTERNAL_BRIDGE_EXECUTOR_PRIVATE_KEY: signerOneKey,
  });
  assert.equal(result.valid, false);
  assert.equal(result.executorIsSigner, true);
});

test("rejects a threshold above the configured signer count", () => {
  assert.throws(
    () => config({ attestationThreshold: 3 }),
    /attestationThreshold must be between 1 and the configured signer count/,
  );
});
