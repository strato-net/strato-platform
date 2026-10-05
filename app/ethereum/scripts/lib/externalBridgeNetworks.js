const NETWORKS = [
  { chainId: 1, name: "mainnet", family: "eth", production: true, rpcEnv: "MAINNET_RPC_URL",
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com", alchemyHost: "eth-mainnet.g.alchemy.com", aliases: ["ethereum", "eth"], defaultDiscovery: true },
  { chainId: 8453, name: "base", family: "base", production: true, rpcEnv: "BASE_RPC_URL",
    defaultRpcUrl: "https://mainnet.base.org", alchemyHost: "base-mainnet.g.alchemy.com", aliases: ["base_mainnet", "base_main"], defaultDiscovery: true },
  { chainId: 59144, name: "linea", family: "linea", production: true, rpcEnv: "LINEA_RPC_URL",
    defaultRpcUrl: "https://rpc.linea.build", alchemyHost: "linea-mainnet.g.alchemy.com", aliases: ["linea_mainnet", "linea-mainnet"] },
  { chainId: 11155111, name: "sepolia", family: "eth", production: false, rpcEnv: "SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", alchemyHost: "eth-sepolia.g.alchemy.com", defaultDiscovery: true },
  { chainId: 84532, name: "baseSepolia", family: "base", production: false, rpcEnv: "BASE_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.base.org", alchemyHost: "base-sepolia.g.alchemy.com", aliases: ["base_sepolia", "base-sepolia", "basesepolia"], defaultDiscovery: true },
  { chainId: 59141, name: "lineaSepolia", family: "linea", production: false, rpcEnv: "LINEA_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://rpc.sepolia.linea.build", alchemyHost: "linea-sepolia.g.alchemy.com", aliases: ["linea_sepolia", "linea-sepolia", "lineasepolia"] },
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
