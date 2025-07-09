export const NATIVE_TOKEN_ADDRESS =
  "0x0000000000000000000000000000000000000000";

export const BRIDGE_TOKEN_ADDRESS = import.meta.env.VITE_BRIDGE_TOKEN_ADDRESS;
export const BRIDGE_TOKEN_ADDRESS_ETH = import.meta.env.VITE_BRIDGE_TOKEN_ADDRESS;
export const BRIDGE_TOKEN_ADDRESS_USDC = import.meta.env.VITE_BRIDGE_TOKEN_ADDRESS_USDC;

export const BRIDGE_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "recipient",
        type: "address",
      },
    ],
    name: "bridge",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const TESTNET_TOKENS = [
  {
    symbol: "SepoliaETH",
    name: "Sepolia Ether",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
  },
];

export const MAINNET_TOKENS = [
  {
    symbol: "ETH",
    name: "Ethereum",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
  },
];

export const TOKEN_ADDRESSES: { [key: string]: { [key: string]: string } } = {
  Ethereum: {
    ETH: NATIVE_TOKEN_ADDRESS, // TODO: change to the correct address
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  Sepolia: {
    SepoliaETH: NATIVE_TOKEN_ADDRESS,
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
};

export const NETWORK_CONFIGS = {
  Sepolia: {
    name: "Sepolia",
    chain: "sepolia",
    chainId: 11155111,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png",
    rpc: ["https://rpc.sepolia.org"],
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
    shortName: "sep",
    infoURL: "https://sepolia.etherscan.io",
    explorers: [
      {
        name: "Etherscan",
        url: "https://sepolia.etherscan.io",
        standard: "EIP3091",
      },
    ],
  },
  Ethereum: {
    name: "Ethereum",
    chain: "ethereum",
    chainId: 1,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png",
    rpc: ["https://eth.llamarpc.com"],
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    shortName: "eth",
    infoURL: "https://etherscan.io",
    explorers: [
      {
        name: "Etherscan",
        url: "https://etherscan.io",
        standard: "EIP3091",
      },
    ],
  }
};
