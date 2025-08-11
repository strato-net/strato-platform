// Bridge configuration constants for backend
// Based on the original bridge service config

// Testnet token contracts
export const TESTNET_ERC20_TOKEN_CONTRACTS = [
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC on Sepolia
];

// Mainnet token contracts  
export const MAINNET_ERC20_TOKEN_CONTRACTS = [
  "0xA0b86a33E6441b8c4C8D7d3C2B0B1B8c4C8D7d3C", // USDC on Mainnet
];

// Testnet ETH to Strato token mapping
export const TESTNET_ETH_STRATO_TOKEN_MAPPING = {
  "0x0000000000000000000000000000000000000000": "0x0000000000000000000000000000000000000000", // ETH
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238": "0x500fb797b0be4ce0edf070a9b17bae56d22a2131", // USDC
};

// Mainnet ETH to Strato token mapping
export const MAINNET_ETH_STRATO_TOKEN_MAPPING = {
  "0x0000000000000000000000000000000000000000": "0x0000000000000000000000000000000000000000", // ETH
  "0xA0b86a33E6441b8c4C8D7d3C2B0B1B8c4C8D7d3C": "0x500fb797b0be4ce0edf070a9b17bae56d22a2131", // USDC
};

// Get current environment configuration
export const getCurrentConfig = () => {
  const isTestnet = process.env.SHOW_TESTNET === "true";
  
  return {
    isTestnet,
    tokenContracts: isTestnet ? TESTNET_ERC20_TOKEN_CONTRACTS : MAINNET_ERC20_TOKEN_CONTRACTS,
    tokenMapping: isTestnet ? TESTNET_ETH_STRATO_TOKEN_MAPPING : MAINNET_ETH_STRATO_TOKEN_MAPPING
  };
}; 