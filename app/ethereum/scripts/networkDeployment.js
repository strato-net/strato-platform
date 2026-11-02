const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ quiet: true });
const { NETWORKS, getExternalBridgeNetwork } = require("./lib/externalBridgeNetworks");

const FAMILY_ALIASES = {
  ethereum: "eth",
  eth: "eth",
  base: "base",
  linea: "linea",
  robinhood: "robinhood",
  hyperevm: "hyperEvm",
};

function selectNetwork(env = process.env) {
  const deploymentEnv = String(env.DEPLOY_ENV || "").trim().toLowerCase();
  if (!["testnet", "prod"].includes(deploymentEnv)) {
    throw new Error("DEPLOY_ENV must be testnet or prod");
  }
  const requested = String(env.NETWORK || "").trim();
  if (!requested) throw new Error("NETWORK must be ethereum, base, linea, robinhood, or hyperevm");
  const production = deploymentEnv === "prod";
  const family = FAMILY_ALIASES[requested.toLowerCase()];
  let network;
  if (family) {
    network = NETWORKS.find((candidate) =>
      candidate.family === family && candidate.production === production);
  } else {
    try {
      const candidate = getExternalBridgeNetwork(requested);
      if (candidate.production === production) network = candidate;
    } catch {
      // Use the common unsupported-combination error below.
    }
  }
  if (!network) {
    throw new Error(`Unsupported deployment target DEPLOY_ENV=${deploymentEnv} NETWORK=${requested}`);
  }
  return network;
}

function buildCommand(action, network, args = []) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  if (action === "deploy-external") {
    if (!network.externalBridgeDeployment) {
      throw new Error(`External Bridge deployment is not enabled for ${network.name}`);
    }
    return { command: process.execPath, args: [require.resolve("./deployExternalBridge"), ...args] };
  }
  if (action === "deploy-proxy" || action === "deploy-implementation") {
    if (args.length) throw new Error(`${action} does not accept command arguments; use environment variables`);
    const script = action === "deploy-proxy" ? "scripts/deployWithProxy.js" : "scripts/deployImplementationOnly.js";
    return { command: npx, args: ["--no-install", "hardhat", "run", script, "--network", network.name] };
  }
  if (action === "verify") {
    if (!args.length) throw new Error("verify requires a deployed contract address");
    return { command: npx, args: ["--no-install", "hardhat", "verify", "--network", network.name, ...args] };
  }
  throw new Error("Use deploy-external|deploy-proxy|deploy-implementation|verify");
}

function deploymentEnvironment(manifestFile, network, env = process.env) {
  if (!manifestFile) return { ...env };
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFile), "utf8"));
  if (manifest.schemaVersion !== 0 || !manifest.discovery?.target) {
    throw new Error("--manifest must reference the reviewed pre-deployment deployment.json");
  }
  const target = manifest.discovery.target;
  if (Number(target.chainId) !== network.chainId) throw new Error("Manifest target chain mismatch");
  const names = {
    SAFE_ADDRESS: target.safeAddress,
    PERMIT2_ADDRESS: target.permit2Address,
    DEPLOYMENT_CONFIRMATIONS: target.deploymentConfirmations,
    VAULT_DEFAULT_ADMIN_ADDRESS: target.roles?.vaultDefaultAdminAddress,
    VAULT_UPGRADER_ADDRESS: target.roles?.vaultUpgraderAddress,
    VAULT_POLICY_ADMIN_ADDRESS: target.roles?.vaultPolicyAdminAddress,
    GUARDIAN_ADDRESS: target.roles?.guardianAddress,
    VAULT_UNPAUSER_ADDRESS: target.roles?.vaultUnpauserAddress,
    VAULT_ATTESTATION_ADMIN_ADDRESS: target.roles?.vaultAttestationAdminAddress,
    LARGE_WITHDRAWAL_APPROVER_ADDRESS: target.roles?.largeWithdrawalApproverAddress,
  };
  const configured = { ...env };
  for (const [name, value] of Object.entries(names)) {
    if (value === undefined || value === "REVIEW_REQUIRED") throw new Error(`Manifest target is missing ${name}`);
    configured[`CHAIN_${network.chainId}_${name}`] = String(value);
  }
  const chainRpc = configured[`CHAIN_${network.chainId}_RPC_URL`];
  if (chainRpc && !configured[network.rpcEnv]) configured[network.rpcEnv] = chainRpc;
  return configured;
}

function environmentExports(network) {
  return [
    `export TARGET_NETWORK=${network.name}`,
    `export TARGET_CHAIN_ID=${network.chainId}`,
    `export TARGET_RPC_ENV=${network.rpcEnv}`,
    `export VERIFIER_COUNT=${network.verifierCount}`,
    `export VERIFIER_THRESHOLD=${network.verifierThreshold}`,
  ].join("\n");
}

function main() {
  const [action, ...rawArgs] = process.argv.slice(2);
  let manifestFile;
  const args = [];
  for (let index = 0; index < rawArgs.length; index++) {
    if (rawArgs[index] === "--manifest") {
      if (!rawArgs[index + 1] || manifestFile) throw new Error("--manifest requires one file");
      manifestFile = rawArgs[++index];
    } else args.push(rawArgs[index]);
  }
  if (manifestFile && action !== "deploy-external") {
    throw new Error("--manifest is supported only by deploy-external");
  }
  const network = selectNetwork();
  if (action === "environment") {
    if (args.length) throw new Error("environment does not accept command arguments");
    console.log(environmentExports(network));
    return;
  }
  const invocation = buildCommand(action, network, args);
  console.log(`network=${network.name} chainId=${network.chainId} environment=${network.production ? "prod" : "testnet"}`);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: require("node:path").resolve(__dirname, ".."),
    env: { ...deploymentEnvironment(manifestFile, network), HARDHAT_NETWORK: network.name },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`network deployment failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { selectNetwork, buildCommand, deploymentEnvironment, environmentExports };
