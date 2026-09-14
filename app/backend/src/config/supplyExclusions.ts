/*
   Supply reporting for CoinGecko, CoinMarketCap and exchange listings.

   Which wallets hold non-circulating supply (team and investor vesting, treasury,
   ecosystem development reserves) is a disclosure decision, not something the
   chain can tell us, so it lives here rather than being derived on-chain.

   Do NOT list:
   - the STRATO staking contract: staked tokens are owned by users and circulate;
   - the native bridge custody vault: its balance backs ERC-20 representations on
     Ethereum and other chains, which circulate there. Those tokens are counted
     once, here on the STRATO chain, and never added again from the other chain.
*/

export const SUPPLY_TOKEN_SYMBOLS = ["STRATO", "USDST", "GOLDST", "SILVST"] as const;

export interface SupplyExclusion {
  address: string;
  label: string;
}

// Balances here are unrecoverable, so they never count as circulating.
export const BURN_ADDRESSES: SupplyExclusion[] = [
  { address: "0000000000000000000000000000000000000000", label: "Zero address" },
  { address: "000000000000000000000000000000000000dead", label: "Burn address" },
];

export const nonCirculatingAddressesFor: Record<string, Record<string, SupplyExclusion[]>> = {
  // Upquark mainnet
  "33056204878082667": {
    // Before submitting STRATO to CoinGecko or CoinMarketCap, list the team,
    // investor, ecosystem-dev and treasury wallets created at TGE here.
    STRATO: [],
  },
  // Helium testnet
  "114784819836269": {},
};

export const getNonCirculatingAddresses = (
  networkId: string | undefined,
  symbol: string
): SupplyExclusion[] => {
  if (!networkId) return [];
  return nonCirculatingAddressesFor[networkId]?.[symbol] || [];
};
