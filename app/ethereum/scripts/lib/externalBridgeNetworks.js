const NETWORKS = [
  { chainId: 1, name: "mainnet", family: "eth", production: true, rpcEnv: "MAINNET_RPC_URL",
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com", alchemyHost: "eth-mainnet.g.alchemy.com", aliases: ["ethereum", "eth"], defaultDiscovery: true,
    externalBridgeDeployment: true, verifierCount: 5, verifierThreshold: 3 },
  { chainId: 8453, name: "base", family: "base", production: true, rpcEnv: "BASE_RPC_URL",
    defaultRpcUrl: "https://mainnet.base.org", alchemyHost: "base-mainnet.g.alchemy.com", aliases: ["base_mainnet", "base_main"], defaultDiscovery: true,
    externalBridgeDeployment: true, verifierCount: 5, verifierThreshold: 3 },
  { chainId: 59144, name: "linea", family: "linea", production: true, rpcEnv: "LINEA_RPC_URL",
    defaultRpcUrl: "https://rpc.linea.build", alchemyHost: "linea-mainnet.g.alchemy.com", aliases: ["linea_mainnet", "linea-mainnet"],
    externalBridgeDeployment: true, verifierCount: 5, verifierThreshold: 3 },
  { chainId: 4663, name: "robinhood", family: "robinhood", production: true, rpcEnv: "ROBINHOOD_RPC_URL",
    defaultRpcUrl: "https://rpc.mainnet.chain.robinhood.com", alchemyHost: "robinhood-mainnet.g.alchemy.com", aliases: ["robinhood_mainnet", "robinhood-mainnet"],
    explorerApiUrl: "https://robinhoodchain.blockscout.com/api", explorerUrl: "https://robinhoodchain.blockscout.com",
    externalBridgeDeployment: true, verifierCount: 5, verifierThreshold: 3 },
  { chainId: 999, name: "hyperEvm", family: "hyperEvm", production: true, rpcEnv: "HYPEREVM_RPC_URL",
    defaultRpcUrl: "https://rpc.hyperliquid.xyz/evm", aliases: ["hyperevm", "hyper_evm", "hyper-evm"],
    explorerApiUrl: "https://hyperscan.gas.zip/api", explorerUrl: "https://hyperscan.gas.zip",
    externalBridgeDeployment: true, verifierCount: 5, verifierThreshold: 3 },
  { chainId: 11155111, name: "sepolia", family: "eth", production: false, rpcEnv: "SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", alchemyHost: "eth-sepolia.g.alchemy.com", defaultDiscovery: true,
    externalBridgeDeployment: true, verifierCount: 3, verifierThreshold: 2 },
  { chainId: 84532, name: "baseSepolia", family: "base", production: false, rpcEnv: "BASE_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.base.org", alchemyHost: "base-sepolia.g.alchemy.com", aliases: ["base_sepolia", "base-sepolia", "basesepolia"], defaultDiscovery: true,
    externalBridgeDeployment: true, verifierCount: 3, verifierThreshold: 2 },
  { chainId: 59141, name: "lineaSepolia", family: "linea", production: false, rpcEnv: "LINEA_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://rpc.sepolia.linea.build", alchemyHost: "linea-sepolia.g.alchemy.com", aliases: ["linea_sepolia", "linea-sepolia", "lineasepolia"],
    externalBridgeDeployment: true, verifierCount: 3, verifierThreshold: 2 },
  { chainId: 46630, name: "robinhoodTestnet", family: "robinhood", production: false, rpcEnv: "ROBINHOOD_TESTNET_RPC_URL",
    defaultRpcUrl: "https://rpc.testnet.chain.robinhood.com", alchemyHost: "robinhood-testnet.g.alchemy.com", aliases: ["robinhood_testnet", "robinhood-testnet"],
    explorerApiUrl: "https://explorer.testnet.chain.robinhood.com/api", explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    externalBridgeDeployment: true, verifierCount: 3, verifierThreshold: 2 },
];

const byChainId = new Map(NETWORKS.map((network) => [network.chainId, network]));
const byName = new Map(NETWORKS.flatMap((network) =>
  [network.name, ...(network.aliases || [])].map((name) => [name.toLowerCase(), network])));

function getExternalBridgeNetwork(value) {
  const numeric = Number(value);
  const network = Number.isSafeInteger(numeric) && String(value).trim() !== ""
    ? byChainId.get(numeric) : byName.get(String(value || "").trim().toLowerCase());
  if (!network) throw new Error(`Unsupported External Bridge network ${value}`);
  return network;
}

function chainRpcEnvironment() {
  return Object.fromEntries(NETWORKS.map(({ chainId, rpcEnv }) => [`CHAIN_${chainId}_RPC_URL`, rpcEnv]));
}

function defaultDiscoveryChains(production) {
  return NETWORKS.filter((network) => network.production === production && network.defaultDiscovery)
    .map(({ chainId }) => chainId).join(",");
}

module.exports = { NETWORKS, getExternalBridgeNetwork, chainRpcEnvironment, defaultDiscoveryChains };
