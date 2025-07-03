export interface Token {
  address: string;
  _name?: string;
  _symbol?: string;
  _owner?: string;
  _totalSupply?: string;
  customDecimals?: number;
  description?: string;
  status?: string;
  images?: Array<{ value: string }>;
  attributes?: Array<{ key: string; value: string }>;
  balances?: Array<{ user: string; balance: string }>;
  minters?: Array<{ user: string; value: boolean }>;
  burners?: Array<{ user: string; value: boolean }>;
  price?: number;
  
  // Legacy fields for backward compatibility
  block_hash?: string;
  block_timestamp?: string;
  block_number?: string;
  transaction_hash?: string;
  transaction_sender?: string;
  creator?: string;
  root?: string;
  contract_name?: string;
  collectionname?: string;
  collectiontype?: string;
  token?: {
    _name: string;
    _symbol: string;
    address?: string;
    images?: any;
    _owner?: string;
    description?: string;
    status?: string;
  },
  available?: boolean;
  provider?: string;
  vaulter?: string;
  color?: string;
  balance?: string;
  key?: string;
  value?: string;
  "BlockApps-Mercata-ERC20"?: {
    data: {
      token: string;
      oracle: string;
      stablecoin: string;
    };
    root: string;
    _name: string;
    _symbol: string;
    address: string;
    creator: string;
    block_hash: string;
    _totalSupply: number;
    block_number: string;
    contract_name: string;
    block_timestamp: string;
    transaction_hash: string;
    transaction_sender: string;
  };
};

export interface CreateTokenValues {
  name: string;
  description: string;
  symbol: string;
  images: string[];
  files: string[];
  fileNames: string[];
  initialSupply: string;
  customDecimals: number;
};

export interface DepositableToken {
  address: string;
  _name: string;
  _symbol: string;
  value: string;           // Usually big numbers as strings
  collateralRatio: string; // string but represents a number
  interestRate: string;
  price: string;
  liquidity: string;
  ltv?: string
}

export interface WithdrawableToken {
  address: string;
  _name: string;
  _symbol: string;
  value?: string;
}
export interface SwappableToken {
  address: string;
  _name: string;
  _symbol: string;
  balance?: string;
  "BlockApps-Mercata-ERC20-_balances": {
    key: string;
    value: string;
  }[];
};

export interface LoanData {
  active: boolean;
  amount: string;
  asset: string;
  collateralAmount: string;
  collateralAsset: string;
  lastUpdated: string;
  user: string;
  assetName: string;
  assetSymbol: string;
  collateralName: string;
  collateralSymbol: string;
  interest: string;
}

export interface Loan {
  key: string;
  loan: LoanData;
}

export interface PriceFormValues {
  tokenAddress: string;
  price: string;
};

/*-------- Pool Values --------*/

export interface PoolFormValues {
  tokenA: string;
  tokenB: string;
  // initialLiquidityA: string;
  // initialLiquidityB: string;
  // poolName?: string;
}

/*-------- OnRamp Values --------*/

export interface OnRampListing {
  id: number;
  token: string;
  seller: string;
  amount: string;
  marginBps: number;
}

export interface OnRampLock {
  amount: string;
  timestamp: number;
}

export interface OnRampPaymentProvider {
  providerAddress: string;
  name: string;
  endpoint: string;
}

export interface OnRampToken {
  token: string;
  [key: string]: any;
}

export interface OnRampContextType {
  token: OnRampToken | null;
  loading: boolean;
  error: string | null;
  
  get: () => Promise<any>;
  buy: (payload: any, userAddress: string) => Promise<{ url: string }>;
  sell: (body: any) => Promise<any>;
  lock: (body: any) => Promise<{ url: string }>;
  unlockTokens: (listingId: string) => Promise<any>;
}