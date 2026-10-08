const { spawnSync } = require("node:child_process");
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
  const [action, ...args] = process.argv.slice(2);
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
    env: { ...process.env, HARDHAT_NETWORK: network.name },
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

module.exports = { selectNetwork, buildCommand, environmentExports };
