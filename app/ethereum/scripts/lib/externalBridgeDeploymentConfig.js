const { NETWORKS, getExternalBridgeNetwork } = require("./externalBridgeNetworks");

const DEPLOYMENT_PROFILES = Object.fromEntries(NETWORKS.map(({ chainId, name, production }) =>
  [chainId, { network: name, production }]));

function parseDeployArgs(argv) {
  const parsed = { execute: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--execute") {
      parsed.execute = true;
      continue;
    }
    if (argv[index] === "--rollout-dir" && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      parsed.rolloutDir = argv[++index];
      continue;
    }
    throw new Error(`Unsupported option ${argv[index]}`);
  }
  return parsed;
}

function getChainEnvName(chainId, name) {
  return `CHAIN_${Number(chainId)}_${name}`;
}

function getDeploymentConfirmations(chainId, env = process.env) {
  const envName = getChainEnvName(chainId, "DEPLOYMENT_CONFIRMATIONS");
  const value = String(env[envName] || "");
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${envName} must be a positive safe integer`);
  }
  return Number(value);
}

function getDeploymentProfile(
  chainId,
  env = process.env,
  { execute = false } = {},
) {
  const normalizedChainId = Number(chainId);
  let network;
  try { network = getExternalBridgeNetwork(normalizedChainId); } catch {
    throw new Error(`Unsupported External Bridge deployment chain ${chainId}`);
  }
  const profile = { network: network.name, production: network.production };
  if (
    profile.production &&
    execute &&
    String(env.CONFIRM_EXTERNAL_BRIDGE_DEPLOY || "") !==
      String(normalizedChainId)
  ) {
    throw new Error(
      `Set CONFIRM_EXTERNAL_BRIDGE_DEPLOY=${normalizedChainId} to deploy on ${profile.network}`,
    );
  }
  return {
    ...profile,
    chainId: normalizedChainId,
    artifactPrefix: profile.production
      ? `ExternalBridgePair_${profile.network}`
      : `ExternalBridgeTestnetPair_${profile.network}`,
  };
}

module.exports = {
  DEPLOYMENT_PROFILES,
  parseDeployArgs,
  getChainEnvName,
  getDeploymentConfirmations,
  getDeploymentProfile,
};
