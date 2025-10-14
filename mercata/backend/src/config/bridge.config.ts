// Bridge configuration constants
export const NODE_URL = process.env.NODE_URL;
export const MERCATA_URL = "BlockApps-MercataEthBridge";

// Token configurations
export const TESTNET_STRATO_TOKENS = [
  {
    name: "STRATO Ether",
    symbol: "ETHST",
    tokenAddress: "0x93fb7295859b2d70199e0a4883b7c320cf874e6c",
    decimals: 18,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "STRATO USDC",
    symbol: "USDCST",
    tokenAddress: "0x3d351a4a339f6eef7371b0b1b025b3a434ad0399",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/USDC/logo.png"
  }
];

export const MAINNET_STRATO_TOKENS = [
  {
    name: "STRATO Ether",
    symbol: "STRATO_ETH",
    tokenAddress: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "STRATO USD Coin",
    symbol: "USDCST",
    tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/USDC/logo.png"
  }
];

export const TESTNET_ETH_TOKENS = [
  {
    name: "Sepolia Ether",
    symbol: "SepoliaETH",
    tokenAddress: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    chainId: 11155111,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "USD Coin",
    symbol: "USDC",
    tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    chainId: 11155111,
    decimals: 6,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/USDC/logo.png"
  }
];

export const MAINNET_ETH_TOKENS = [
  {
    name: "Ethereum",
    symbol: "ETH",
    tokenAddress: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    chainId: 1,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "USD Coin",
    symbol: "USDC",
    tokenAddress: "0xA0b86a33E6441b8c4C8C0C0C0C0C0C0C0C0C0C0",
    chainId: 1,
    decimals: 6,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/USDC/logo.png"
  }
];

export const TESTNET_ETH_STRATO_TOKEN_MAPPING = {
  '0x0000000000000000000000000000000000000000': '0x93fb7295859b2d70199e0a4883b7c320cf874e6c',
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': '0x3d351a4a339f6eef7371b0b1b025b3a434ad0399'
};

export const MAINNET_ETH_STRATO_TOKEN_MAPPING = {
  '0x0000000000000000000000000000000000000000': '0x0000000000000000000000000000000000000000',
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
};

// Helper function to get exchange token info for bridge out
export const getExchangeTokenInfoBridgeOut = (
  tokenAddress: string,
  showTestnet: boolean
) => {
  const map = Object.fromEntries(
    Object.entries(
      showTestnet ? TESTNET_ETH_STRATO_TOKEN_MAPPING : MAINNET_ETH_STRATO_TOKEN_MAPPING
    ).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])
  );

  const reverseMap = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  const ethTokenAddress = reverseMap[tokenAddress.toLowerCase()];
  const tokens = showTestnet ? TESTNET_ETH_TOKENS : MAINNET_ETH_TOKENS;

  const token = tokens.find(t => t.tokenAddress.toLowerCase() === ethTokenAddress);
  return {
    exchangeTokenName: token?.name || '',
    exchangeTokenSymbol: token?.symbol || '',
    exchangeTokenAddress: token?.tokenAddress || ''
  };
}; 