/**
 * Card provider → network → token hierarchy.
 * Each provider supports specific networks; each (provider, network) supports specific token symbols.
 * externalToken address is resolved from the bridge (bridgeable tokens for that chain) by symbol when supported.
 * Use testnetOnly/mainnetOnly so testnet shows Base Sepolia and mainnet shows Base (see Bridge In on Deposit page).
 */

export interface CardProviderNetwork {
  chainId: string;
  chainName: string;
  /** If true, only show this network when app is on testnet (e.g. Base Sepolia). */
  testnetOnly?: boolean;
  /** If true, only show this network when app is on mainnet (e.g. Base). */
  mainnetOnly?: boolean;
}

export interface CardProvider {
  id: string;
  name: string;
  networks: CardProviderNetwork[];
  /** (chainId) => token symbols supported for this provider on that network */
  tokensByNetwork: Record<string, string[]>;
}

/** MetaMask Card: Linea, Solana, Base (mainnet) / Base Sepolia (testnet) with the specified tokens per network */
const METAMASK_CARD: CardProvider = {
  id: "metamask-card",
  name: "MetaMask Card",
  networks: [
    // { chainId: "59144", chainName: "Linea" },
    // { chainId: "solana", chainName: "Solana" },
    { chainId: "8453", chainName: "Base", mainnetOnly: true },
    { chainId: "84532", chainName: "Base Sepolia", testnetOnly: true },
  ],
  tokensByNetwork: {
    "59144": ["mUSD", "USDC", "USDT", "wETH", "EURe", "GBPe", "aUSDC", "amUSD"],
    solana: ["USDC", "USDT"],
    "8453": ["USDC"], //, "USDT", "aBasUSDC"],
    "84532": ["USDC"], //, "USDT", "aBasUSDC"],
  },
};

/** Ether.fi Card: Base (mainnet) / Base Sepolia (testnet) */
const ETHERFI_CARD: CardProvider = {
  id: "etherfi-card",
  name: "Ether.fi Card",
  networks: [
    { chainId: "8453", chainName: "Base", mainnetOnly: true },
    { chainId: "84532", chainName: "Base Sepolia", testnetOnly: true },
  ],
  tokensByNetwork: {
    "8453": ["USDC", "USDT", "aBasUSDC"],
    "84532": ["USDC", "USDT", "aBasUSDC"],
  },
};

export const CARD_PROVIDERS: CardProvider[] = [METAMASK_CARD]; //, ETHERFI_CARD];

export function getProviderById(id: string): CardProvider | undefined {
  return CARD_PROVIDERS.find((p) => p.id === id);
}

/**
 * Returns networks for a provider, filtered by testnet so testnet shows Base Sepolia and mainnet shows Base.
 */
export function getNetworksForProvider(
  providerId: string,
  isTestnet?: boolean
): CardProviderNetwork[] {
  const p = getProviderById(providerId);
  if (!p) return [];
  const testnet = isTestnet === true;
  return p.networks.filter((n) => {
    if (n.testnetOnly) return testnet;
    if (n.mainnetOnly) return !testnet;
    return true;
  });
}

export function getTokensForProviderNetwork(
  providerId: string,
  chainId: string
): string[] {
  const p = getProviderById(providerId);
  if (!p) return [];
  return p.tokensByNetwork[chainId] ?? [];
}

/**
 * Find a provider that supports this (chainId, tokenSymbol) so we can restore selection from saved config.
 */
export function findProviderNetworkToken(
  chainId: string,
  tokenSymbol: string
): { providerId: string; chainId: string; tokenSymbol: string } | undefined {
  for (const p of CARD_PROVIDERS) {
    const tokens = p.tokensByNetwork[chainId];
    if (!tokens) continue;
    const match = tokens.some(
      (s) => s.toUpperCase() === tokenSymbol.toUpperCase()
    );
    if (match) {
      return { providerId: p.id, chainId, tokenSymbol };
    }
  }
  return undefined;
}

/**
 * Get display label for a card (provider name, network name) given chainId and tokenSymbol.
 */
export function getCardDisplayLabel(
  chainId: string,
  tokenSymbol: string
): { providerName: string; networkName: string } | null {
  const found = findProviderNetworkToken(chainId, tokenSymbol);
  if (!found) return null;
  const provider = getProviderById(found.providerId);
  if (!provider) return null;
  const network = provider.networks.find((n) => n.chainId === chainId);
  return {
    providerName: provider.name,
    networkName: network?.chainName ?? chainId,
  };
}

/** Resolve chainId to network name (e.g. 84532 -> "Base Sepolia") */
export function getNetworkName(chainId: string): string {
  for (const p of CARD_PROVIDERS) {
    const network = p.networks.find((n) => n.chainId === chainId);
    if (network) return network.chainName;
  }
  return chainId;
}
