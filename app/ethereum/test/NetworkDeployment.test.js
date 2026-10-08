const assert = require("node:assert/strict");
const test = require("node:test");
const { selectNetwork, buildCommand, environmentExports } = require("../scripts/networkDeployment");

const select = (DEPLOY_ENV, NETWORK) => selectNetwork({ DEPLOY_ENV, NETWORK });

test("selects all supported testnet and production targets", () => {
  assert.deepEqual([
    select("testnet", "ethereum").chainId,
    select("testnet", "base").chainId,
    select("testnet", "linea").chainId,
    select("testnet", "robinhood").chainId,
  ], [11155111, 84532, 59141, 46630]);
  assert.deepEqual([
    select("prod", "ethereum").chainId,
    select("prod", "base").chainId,
    select("prod", "linea").chainId,
    select("prod", "robinhood").chainId,
    select("prod", "hyperevm").chainId,
  ], [1, 8453, 59144, 4663, 999]);
});

test("rejects missing, mismatched, and unsupported environment targets", () => {
  assert.throws(() => selectNetwork({}), /DEPLOY_ENV/);
  assert.throws(() => select("staging", "base"), /DEPLOY_ENV/);
  assert.throws(() => select("testnet", "hyperevm"), /Unsupported deployment target/);
  assert.throws(() => select("prod", "sepolia"), /Unsupported deployment target/);
});

test("builds generic deployment and verification commands", () => {
  const network = select("prod", "robinhood");
  const external = buildCommand("deploy-external", network, ["--rollout-dir", "/secure/eab"]);
  assert.equal(external.command, process.execPath);
  assert.deepEqual(external.args.slice(-2), ["--rollout-dir", "/secure/eab"]);
  assert.deepEqual(buildCommand("deploy-proxy", network).args.slice(-2), ["--network", "robinhood"]);
  assert.deepEqual(buildCommand("deploy-implementation", network).args.slice(-2), ["--network", "robinhood"]);
  assert.deepEqual(buildCommand("verify", network, ["0x" + "1".repeat(40)]).args.slice(-3),
    ["--network", "robinhood", "0x" + "1".repeat(40)]);
  assert.throws(() => buildCommand("verify", network), /requires a deployed contract address/);
  assert.throws(() => buildCommand("unknown", network), /Use deploy-external/);
});

test("derives all per-network runbook values from one environment selection", () => {
  for (const [deploymentEnv, names] of [
    ["testnet", ["ethereum", "base", "linea", "robinhood"]],
    ["prod", ["ethereum", "base", "linea", "robinhood", "hyperevm"]],
  ]) {
    for (const name of names) {
      const network = select(deploymentEnv, name);
      assert.equal(environmentExports(network), [
        `export TARGET_NETWORK=${network.name}`,
        `export TARGET_CHAIN_ID=${network.chainId}`,
        `export TARGET_RPC_ENV=${network.rpcEnv}`,
        `export VERIFIER_COUNT=${deploymentEnv === "testnet" ? 3 : 5}`,
        `export VERIFIER_THRESHOLD=${deploymentEnv === "testnet" ? 2 : 3}`,
      ].join("\n"));
    }
  }
});
