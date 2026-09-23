const PROFILE_TESTNET = "testnet";
const PROFILE_PROD = "prod";
const { NETWORKS, chainRpcEnvironment, defaultDiscoveryChains } = require("./externalBridgeNetworks");

const PROFILE_ALIASES = {
  testnet: PROFILE_TESTNET,
  tst: PROFILE_TESTNET,
  prod: PROFILE_PROD,
  prodnet: PROFILE_PROD,
  mainnet: PROFILE_PROD,
};

const DEFAULTS = {
  [PROFILE_TESTNET]: {
    NODE_URL: "https://node1.testnet.strato.nexus",
    DEFAULT_CHAINS: defaultDiscoveryChains(false),
  },
  [PROFILE_PROD]: {
    NODE_URL: "https://app.strato.nexus",
    DEFAULT_CHAINS: defaultDiscoveryChains(true),
  },
};

const CHAIN_RPC_ENV_MAP = chainRpcEnvironment();

function normalizeProfile(value) {
  const key = String(value || PROFILE_TESTNET).trim().toLowerCase();
  return PROFILE_ALIASES[key] || PROFILE_TESTNET;
}

function getProfileFromArgv(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--env") continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error("Missing value for --env");
    }
    return normalizeProfile(next);
  }
  return PROFILE_TESTNET;
}

function applyEnvProfile(profile) {
  const normalized = normalizeProfile(profile);

  // Environment flag is authoritative for Cirrus target.
  process.env.NODE_URL = DEFAULTS[normalized].NODE_URL;

  const alchemyKey = String(process.env.ALCHEMY_API_KEY || "").trim();
  if (!alchemyKey) {
    throw new Error("Missing ALCHEMY_API_KEY");
  }
  for (const { rpcEnv: key, alchemyHost } of NETWORKS) {
    const fallback = `https://${alchemyHost}/v2/${alchemyKey}`;
    if (!process.env[key]) {
      process.env[key] = fallback;
    }
  }

  for (const [chainRpcKey, genericRpcKey] of Object.entries(CHAIN_RPC_ENV_MAP)) {
    if (!process.env[chainRpcKey]) {
      process.env[chainRpcKey] = process.env[genericRpcKey];
    }
  }

  return {
    profile: normalized,
    defaultChainsCsv: DEFAULTS[normalized].DEFAULT_CHAINS,
    nodeUrl: process.env.NODE_URL,
  };
}

module.exports = {
  PROFILE_TESTNET,
  PROFILE_PROD,
  normalizeProfile,
  getProfileFromArgv,
  applyEnvProfile,
};
