const PROFILE_TESTNET = "testnet";
const PROFILE_PROD = "prod";

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
    DEFAULT_CHAINS: "11155111,84532",
  },
  [PROFILE_PROD]: {
    NODE_URL: "https://app.strato.nexus",
    DEFAULT_CHAINS: "1,8453",
  },
};

const CHAIN_RPC_ENV_MAP = {
  CHAIN_11155111_RPC_URL: "SEPOLIA_RPC_URL",
  CHAIN_84532_RPC_URL: "BASE_SEPOLIA_RPC_URL",
  CHAIN_1_RPC_URL: "MAINNET_RPC_URL",
  CHAIN_8453_RPC_URL: "BASE_RPC_URL",
  CHAIN_59144_RPC_URL: "LINEA_RPC_URL",
};

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
  const rpcDefaults = {
    SEPOLIA_RPC_URL: `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`,
    BASE_SEPOLIA_RPC_URL: `https://base-sepolia.g.alchemy.com/v2/${alchemyKey}`,
    MAINNET_RPC_URL: `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    BASE_RPC_URL: `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    LINEA_RPC_URL: `https://linea-mainnet.g.alchemy.com/v2/${alchemyKey}`,
  };

  for (const [key, fallback] of Object.entries(rpcDefaults)) {
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
