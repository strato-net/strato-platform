const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getChainEnvName,
  getDeploymentProfile,
  parseDeployArgs,
} = require("../scripts/lib/externalBridgeDeploymentConfig");

test("defaults to preflight and accepts only execute", () => {
  assert.deepEqual(parseDeployArgs([]), { execute: false });
  assert.deepEqual(parseDeployArgs(["--execute"]), { execute: true });
  assert.throws(() => parseDeployArgs(["--unknown"]), /Unsupported option/);
});

test("builds chain-prefixed deployment variable names", () => {
  assert.equal(
    getChainEnvName(84532n, "SAFE_ADDRESS"),
    "CHAIN_84532_SAFE_ADDRESS",
  );
  assert.equal(
    getChainEnvName(59144, "VAULT_POLICY_ADMIN_ADDRESS"),
    "CHAIN_59144_VAULT_POLICY_ADMIN_ADDRESS",
  );
});

test("allows Sepolia without production confirmation", () => {
  assert.deepEqual(getDeploymentProfile(11155111n, {}), {
    network: "sepolia",
    production: false,
    chainId: 11155111,
    artifactPrefix: "ExternalBridgeTestnetPair_sepolia",
  });
});

for (const [chainId, network] of [
  [84532, "baseSepolia"],
  [59141, "lineaSepolia"],
]) {
  test(`allows ${network} without production confirmation`, () => {
    assert.deepEqual(getDeploymentProfile(chainId, {}), {
      network,
      production: false,
      chainId,
      artifactPrefix: `ExternalBridgeTestnetPair_${network}`,
    });
  });
}

for (const [chainId, network] of [
  [1, "mainnet"],
  [8453, "base"],
  [59144, "linea"],
]) {
  test(`requires exact ${network} confirmation only for execution`, () => {
    assert.equal(getDeploymentProfile(chainId, {}).network, network);
    assert.throws(
      () => getDeploymentProfile(chainId, {}, { execute: true }),
      new RegExp(`CONFIRM_EXTERNAL_BRIDGE_DEPLOY=${chainId}`),
    );
    assert.throws(
      () =>
        getDeploymentProfile(
          chainId,
          {
            CONFIRM_EXTERNAL_BRIDGE_DEPLOY: "999",
          },
          { execute: true },
        ),
      new RegExp(`CONFIRM_EXTERNAL_BRIDGE_DEPLOY=${chainId}`),
    );
    assert.deepEqual(
      getDeploymentProfile(
        chainId,
        {
          CONFIRM_EXTERNAL_BRIDGE_DEPLOY: String(chainId),
        },
        { execute: true },
      ),
      {
        network,
        production: true,
        chainId,
        artifactPrefix: `ExternalBridgePair_${network}`,
      },
    );
  });
}

test("rejects unsupported deployment chains", () => {
  assert.throws(
    () => getDeploymentProfile(31337, {}),
    /Unsupported External Bridge deployment chain 31337/,
  );
});
