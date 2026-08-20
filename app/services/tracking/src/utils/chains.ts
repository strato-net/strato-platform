// External chains the STRATO bridge accepts deposits from, with their
// etherscan-style block explorers. Mirrors SUPPORTED_CHAINS in the main app
// (and EXTERNAL_EXPLORERS in ui/src/api.ts); unknown chain ids simply render
// without a name or a link.
export interface ExternalChain {
  name: string;
  explorer: string;
  baseUrl: string; // no trailing slash
  nativeSymbol: string;
}

const CHAINS: Record<number, ExternalChain> = {
  1: { name: "Ethereum", explorer: "Etherscan", baseUrl: "https://etherscan.io", nativeSymbol: "ETH" },
  11155111: { name: "Sepolia", explorer: "Sepolia Etherscan", baseUrl: "https://sepolia.etherscan.io", nativeSymbol: "ETH" },
  137: { name: "Polygon", explorer: "Polygonscan", baseUrl: "https://polygonscan.com", nativeSymbol: "POL" },
  80002: { name: "Amoy", explorer: "Amoy Polygonscan", baseUrl: "https://amoy.polygonscan.com", nativeSymbol: "POL" },
  10: { name: "Optimism", explorer: "Optimistic Etherscan", baseUrl: "https://optimistic.etherscan.io", nativeSymbol: "ETH" },
  8453: { name: "Base", explorer: "Basescan", baseUrl: "https://basescan.org", nativeSymbol: "ETH" },
  84532: { name: "Base Sepolia", explorer: "Sepolia Basescan", baseUrl: "https://sepolia.basescan.org", nativeSymbol: "ETH" },
  59144: { name: "Linea", explorer: "Lineascan", baseUrl: "https://lineascan.build", nativeSymbol: "ETH" },
  59141: { name: "Linea Sepolia", explorer: "Sepolia Lineascan", baseUrl: "https://sepolia.lineascan.build", nativeSymbol: "ETH" },
  42161: { name: "Arbitrum One", explorer: "Arbiscan", baseUrl: "https://arbiscan.io", nativeSymbol: "ETH" },
  42170: { name: "Arbitrum Nova", explorer: "Nova Arbiscan", baseUrl: "https://nova.arbiscan.io", nativeSymbol: "ETH" },
  56: { name: "BNB Chain", explorer: "BscScan", baseUrl: "https://bscscan.com", nativeSymbol: "BNB" },
  43114: { name: "Avalanche", explorer: "Snowtrace", baseUrl: "https://snowtrace.io", nativeSymbol: "AVAX" },
};

export const externalChain = (chainId: number | null): ExternalChain | null =>
  chainId == null ? null : CHAINS[chainId] ?? null;

export const externalChainName = (chainId: number | null): string | null =>
  externalChain(chainId)?.name ?? null;

export const externalTxUrl = (chainId: number | null, txHash: string | null): string | null => {
  const chain = externalChain(chainId);
  if (!chain || !txHash) return null;
  return `${chain.baseUrl}/tx/${txHash}`;
};
