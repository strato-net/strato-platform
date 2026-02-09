/**
 * Card provider → network → token hierarchy.
 * Each provider supports specific networks; each (provider, network) supports specific token symbols.
 * externalToken address is resolved from the bridge (bridgeable tokens for that chain) by symbol when supported.
 */

export interface CardProviderNetwork {
  chainId: string;
  chainName: string;
}

export interface CardProvider {
  id: string;
  name: string;
  networks: CardProviderNetwork[];
  /** (chainId) => token symbols supported for this provider on that network */
  tokensByNetwork: Record<string, string[]>;
}

/** MetaMask Card: Linea, Solana, Base with the specified tokens per network */
const METAMASK_CARD: CardProvider = {
  id: "metamask-card",
  name: "MetaMask Card",
  networks: [
    { chainId: "59144", chainName: "Linea" },
    { chainId: "solana", chainName: "Solana" },
    { chainId: "8453", chainName: "Base" },
  ],
  tokensByNetwork: {
    "59144": ["mUSD", "USDC", "USDT", "wETH", "EURe", "GBPe", "aUSDC", "amUSD"],
    solana: ["USDC", "USDT"],
    "8453": ["USDC", "USDT", "aBasUSDC"],
  },
};

export const CARD_PROVIDERS: CardProvider[] = [METAMASK_CARD];

export function getProviderById(id: string): CardProvider | undefined {
  return CARD_PROVIDERS.find((p) => p.id === id);
}

export function getNetworksForProvider(providerId: string): CardProviderNetwork[] {
  const p = getProviderById(providerId);
  return p ? p.networks : [];
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
