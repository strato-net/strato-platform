export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';
export const BRIDGE_CONTRACT_ADDRESS = '0x3b4c09be3079e6eb309845ec03eab5e42c9a7cfa';
export const SAFE_ADDRESS = '0xF53Bf6b905481beD5c43Fa83Ee3e5703f8584aB1';

export const BRIDGE_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "bridge",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const BRIDGEABLE_TOKENS = [
  {
    symbol: 'WBTC',
    stSymbol: 'WBTCST',
    name: 'Wrapped Bitcoin',
    stName: 'Wrapped Bitcoin ST'
  },
  {
    symbol: 'ETH',
    stSymbol: 'ETHST',
    name: 'Ethereum',
    stName: 'Ethereum ST'
  },
  {
    symbol: 'USDT',
    stSymbol: 'USDTST',
    name: 'Tether USD',
    stName: 'Tether USD ST'
  },
  {
    symbol: 'USDC',
    stSymbol: 'USDCST',
    name: 'USD Coin',
    stName: 'USD Coin ST'
  },
  {
    symbol: 'PAXG',
    stSymbol: 'PAXGST',
    name: 'Pax Gold',
    stName: 'Pax Gold ST'
  }
];

export const TESTNET_TOKENS = [
  {
    symbol: 'SepoliaETH',
    stSymbol: 'SepoliaETHST',
    name: 'Sepolia Ether',
    stName: 'Sepolia Ether ST'
  },
  {
    symbol: 'GoerliETH',
    stSymbol: 'GoerliETHST',
    name: 'Goerli Ether',
    stName: 'Goerli Ether ST'
  },
  {
    symbol: 'MumbaiMATIC',
    stSymbol: 'MumbaiMATICST',
    name: 'Mumbai Matic',
    stName: 'Mumbai Matic ST'
  }
];

export const TOKEN_ADDRESSES: { [key: string]: { [key: string]: string } } = {
  'Ethereum': {
    'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    'ETH': NATIVE_TOKEN_ADDRESS,
    'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'PAXG': '0x45804880De22913dAFE09f4980848ECE6EcbAf78'
  },
  'Polygon': {
    'WBTC': '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
    'ETH': '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    'USDT': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    'USDC': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    'PAXG': '0x553d3D295e0f695B9228246232eDF400ed3560B5'
  },
  'Sepolia': {
    'SepoliaETH': NATIVE_TOKEN_ADDRESS,
    'GoerliETH': NATIVE_TOKEN_ADDRESS,
    'MumbaiMATIC': NATIVE_TOKEN_ADDRESS
  }
};

export const NETWORK_CONFIGS = {
  'Sepolia': {
    name: 'Sepolia',
    chain: 'sepolia',
    chainId: 11155111,
    icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png',
    rpc: ['https://rpc.sepolia.org'],
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18
    },
    shortName: 'sep',
    infoURL: 'https://sepolia.etherscan.io',
    explorers: [{
      name: 'Etherscan',
      url: 'https://sepolia.etherscan.io',
      standard: 'EIP3091'
    }]
  },
  'Ethereum': {
    name: 'Ethereum',
    chain: 'ethereum',
    chainId: 1,
    icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png',
    rpc: ['https://eth.llamarpc.com'],
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    shortName: 'eth',
    infoURL: 'https://etherscan.io',
    explorers: [{
      name: 'Etherscan',
      url: 'https://etherscan.io',
      standard: 'EIP3091'
    }]
  },
  'Polygon': {
    name: 'Polygon',
    chain: 'polygon',
    chainId: 137,
    icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/MATIC/logo.png',
    rpc: ['https://polygon.llamarpc.com'],
    nativeCurrency: {
      name: 'Matic',
      symbol: 'MATIC',
      decimals: 18
    },
    shortName: 'matic',
    infoURL: 'https://polygonscan.com',
    explorers: [{
      name: 'PolygonScan',
      url: 'https://polygonscan.com',
      standard: 'EIP3091'
    }]
  }
}; 