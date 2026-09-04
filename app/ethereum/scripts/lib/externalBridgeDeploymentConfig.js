const DEPLOYMENT_PROFILES = {
  1: { network: "mainnet", production: true },
  8453: { network: "base", production: true },
  59144: { network: "linea", production: true },
  84532: { network: "baseSepolia", production: false },
  59141: { network: "lineaSepolia", production: false },
  11155111: { network: "sepolia", production: false },
};

function parseDeployArgs(argv) {
  const unsupported = argv.filter((arg) => arg !== "--execute");
  if (unsupported.length > 0) {
    throw new Error(`Unsupported option ${unsupported[0]}`);
  }
  return { execute: argv.includes("--execute") };
}

function getChainEnvName(chainId, name) {
  return `CHAIN_${Number(chainId)}_${name}`;
}

function getDeploymentProfile(
  chainId,
  env = process.env,
  { execute = false } = {},
) {
  const normalizedChainId = Number(chainId);
  const profile = DEPLOYMENT_PROFILES[normalizedChainId];
  if (!profile) {
    throw new Error(`Unsupported External Bridge deployment chain ${chainId}`);
  }
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
  getDeploymentProfile,
};
