/**
 * Card providers: each has a fixed chain and token (usually USDC) that the provider uses for the card wallet.
 * Chain IDs must match bridge-enabled networks. Token is resolved by symbol from bridgeable tokens for that chain.
 */
export interface CardProvider {
  id: string;
  name: string;
  chainId: string;
  chainName: string;
  tokenSymbol: string;
}

export const CARD_PROVIDERS: CardProvider[] = [
  { id: "metamask-card", name: "MetaMask Card", chainId: "1", chainName: "Ethereum", tokenSymbol: "USDC" },
  { id: "rain", name: "Rain.xyz", chainId: "1", chainName: "Ethereum", tokenSymbol: "USDC" },
  { id: "etherfi", name: "Ether.fi", chainId: "1", chainName: "Ethereum", tokenSymbol: "USDC" },
  { id: "polygon-generic", name: "Polygon (USDC)", chainId: "137", chainName: "Polygon", tokenSymbol: "USDC" },
  { id: "arbitrum-generic", name: "Arbitrum (USDC)", chainId: "42161", chainName: "Arbitrum One", tokenSymbol: "USDC" },
  { id: "base-generic", name: "Base (USDC)", chainId: "8453", chainName: "Base", tokenSymbol: "USDC" },
];

export function getProviderById(id: string): CardProvider | undefined {
  return CARD_PROVIDERS.find((p) => p.id === id);
}

export function getProviderByChainAndToken(
  chainId: string,
  tokenSymbol: string
): CardProvider | undefined {
  return CARD_PROVIDERS.find(
    (p) => p.chainId === chainId && p.tokenSymbol.toUpperCase() === tokenSymbol.toUpperCase()
  );
}
