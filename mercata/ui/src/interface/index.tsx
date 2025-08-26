export interface Token {
  name?: string;
  symbol?: string;
  address: string;
  _name: string;
  _symbol: string;
  _owner?: string;
  _totalSupply: string;
  customDecimals?: number;
  description?: string;
  status?: string;
  images?: Array<{ value: string }>;
  attributes?: Array<{ key: string; value: string }>;
  balances?: Array<{ user: string; balance: string; collateralBalance?: string }>;
  minters?: Array<{ user: string; value: boolean }>;
  burners?: Array<{ user: string; value: boolean }>;
  price?: number | string;
  
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
    images?: {value: string}[];
    _owner?: string;
    description?: string;
    status?: string;
  },
  available?: boolean;
  provider?: string;
  vaulter?: string;
  color?: string;
  balance?: string;
  collateralBalance?: string;
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
  files: File[];
  file: File;
  fileNames: string[];
  initialSupply: string;
  customDecimals: number;
  image: File;
};

export interface CreateTokenPayload {
  name: string;
  description: string;
  symbol: string;
  images: string[];       // base64 string
  files: string[];        // ✅ base64 strings
  fileNames: string[];
  initialSupply: string;
  customDecimals: number;
}

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
  _totalSupply: string;
  images?: Array<{ value: string }>;
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
  assetName?: string;
  assetSymbol?: string;
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
  token: Token;
}

export interface BuyPayload {
  amount: string;
  token: string;
  paymentProviderAddress: string;
}

export interface SellPayload {
  token: string;
  amount: string;
  marginBps: string;
  providerAddresses: string[];
}

export interface OnRampContextType {
  token: OnRampToken | null;
  loading: boolean;
  error: string | null;
  onRampData: OnrampApiResponse | null;
  providers: PaymentProvider[];
  listings: Listing[];
  
  get: () => Promise<OnrampApiResponse>;
  buy: (payload: BuyPayload, userAddress: string) => Promise<{ url: string }>;
  sell: (payload: SellPayload) => Promise<any>;
  lock: (body: any) => Promise<{ url: string }>;
  unlockTokens: (listingId: string) => Promise<void>;
  addPaymentProvider: (providerData: AddPaymentProviderData) => Promise<any>;
  removePaymentProvider: (providerAddress: string) => Promise<any>;
  cancelListing: (token: string) => Promise<any>;
  updateListing: (payload: {
    token: string;
    amount: string;
    marginBps: string;
    providerAddresses: string[];
  }) => Promise<any>;
}

export interface RawWithdrawData {
  extToken: string;
  withdrawalId: number;
  withdrawalInfo: {
    dest: string;
    user: string;
    token: string;
    amount: string;
    destChainId: string;
    requestedAt: string;
    bridgeStatus: string;
  };
  // Legacy fields for backward compatibility (will be mapped from withdrawalInfo)
  transaction_hash?: string;
  block_timestamp?: string;
  from?: string;
  to?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
  tokenDecimal?: number;
  txHash?: string;
  withdrawalStatus?: string;
  tokenSymbol?: string;
}

export interface RawDepositData {
  stratoTokenSymbol: string;
  stratoToken: string;
  extToken: string;
  chainId: any;
  transaction_hash: string;
  block_timestamp: string;
  from: string;
  to: string;
  tokenSymbol?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
  amount?: string;
  tokenDecimal?: number;
  txHash?: string;
  token?: string;
  key?: string;
  depositStatus?: string;
  // New fields for updated API response
  depositId?: number;
  depositInfo?: {
    user: string;
    token: string;
    amount: string;
    bridgeStatus: string;
  };
}

export interface CollateralData {
  address: string;
  assetPrice: string; // Typically a string because it's a large number (in wei or similar)
  canSupply: boolean;
  collateralizedAmount: string;
  collateralizedAmountValue: string;
  customDecimals: number;
  isCollateralized: boolean;
  liquidationThreshold: string; // Possibly in basis points (e.g., "8000" = 80%)
  ltv: string; // Loan-to-Value ratio (e.g., "7500" = 75%)
  maxBorrowingPower: string; // Usually a percent string
  userBalance: string;
  userBalanceValue: string;
  _name: string;
  _owner: string;
  _symbol: string;
  _totalSupply: string;
  images?: Array<{ value: string }>;
  asset?: string;
  maxRepay?: string;
  symbol?: string;
  amount?: string;
  usdValue?: string;
  liquidationBonus?: string;
  bonus?: string;
  expectedProfit?: string;
}

export interface TokenInfo {
  address: string;
  customDecimals: number;
  price: string; // kept as string due to possible large values (wei)
  userBalance: string;
  _name: string;
  _owner: string;
  _symbol: string;
  _totalSupply: string;
  exchangeRate?: string;
  maxWithdrawableUSDST?: string;
}

export interface LiquidityData {
  availableLiquidity: string;
  borrowAPY: number;
  exchangeRate: string;
  supplyAPY: number;
  maxSupplyAPY: number;
  supplyable: TokenInfo;
  withdrawable: TokenInfo;
  totalBorrowed: string;
  totalCollateralValue: string;
  totalUSDSTSupplied: string;
  utilizationRate: number;
  maxWithdrawableUSDST: string;
  borrowIndex?: string;           // RAY (1e27)
  reservesAccrued?: string;       // underlying (1e18)

  // new (optional)
  totalAmountOwed?: string;
  totalAmountOwedPreview?: string;
}

export interface CollateralRatioItem {
  asset: string;
  ratio: string;
}

export interface InterestRateItem {
  asset: string;
  rate: string;
}

export interface LiquidationBonusItem {
  asset: string;
  bonus: string;
}

export interface AssetConfig {
  interestRate: string;
  liquidationBonus: string;
  liquidationThreshold: string;
  ltv: string;
  reserveFactor: string;
}

export interface LendData {
  lendingPool: {
    assetConfigs: Record<string, AssetConfig>;
  }
}

// Backend response structure for lending pool data
// This is the actual structure returned by the API which may differ from LendData
export interface LendingPoolResponse {
  registry?: unknown;
  pool?: {
    assetConfigs: Array<{
      asset: string;
      AssetConfig: AssetConfig;
    }> | Record<string, AssetConfig>;
  };
  lendingPool?: {
    assetConfigs: Array<{
      asset: string;
      AssetConfig: AssetConfig;
    }> | Record<string, AssetConfig>;
  };
}

export interface LiquidityPool {
  address: string;
  _owner: string;
  swapFeeRate: number;
  lpSharePercent: number;
  aToBRatio: string;
  bToARatio: string;
  tokenABalance: string;
  tokenBBalance: string;
  tokenA: Token;
  tokenB: Token;
  lpToken: Token;
  tokenAPrice: string;
  tokenBPrice: string;
  lpTokenPrice: string;
  totalLiquidityUSD?: string;
  tradingVolume24h?: string;
  apy?: string;
  _name?: string;
  _symbol?: string;
}

export interface SetPoolRatesData {
  poolAddress: string;
  swapFeeRate: number;
  lpSharePercent: number;
}

export type NewLoanData = {
  totalAmountOwed: string;             // current debt (index-based)
  totalAmountOwedPreview?: string;     // projected debt (optional)
  exchangeRate?: string;               // 1e18 (optional, if you surface it here)
  lastUpdated?: string;
  healthFactor: number;
  healthFactorRaw: string;
  totalBorrowingPowerUSD: string;
  totalCollateralValueUSD: string;
  maxAvailableToBorrowUSD: string;
  interestRate: number;                // bps
  isAboveLiquidationThreshold: boolean;
  id?: string;
  maxRepay?: string;
  assetSymbol?: string;
};

export interface ApiErrorResponse {
  message: string;
  code?: string;
  errors?: Record<string, string[]>;
}

export interface PaymentProviderValue {
  name: string;
  exists: boolean;
  endpoint: string;
  providerAddress: string;
}

export interface PaymentProvider {
  key: string;
  value: PaymentProviderValue;
}

export interface AddPaymentProviderData {
  providerAddress: string;
  name: string;
  endpoint: string;
}
export interface ApprovedToken {
  token: string;
  _name: string;
  _symbol: string;
}

export interface ListingInfo {
  id: string;
  token: string;
  amount: string;
  seller: string;
  marginBps: string;
  providers: PaymentProviderValue[];
  _name: string;
  _symbol: string;
  tokenOracleValue: { price: string } | null;
}

export interface Listing {
  key: string;
  ListingInfo: ListingInfo;
}

export interface OnrampApiResponse {
  address: string;
  listings: Listing[];
  paymentProviders: PaymentProvider[];
  approvedTokens: ApprovedToken[];
}

export interface Pool {
  address: string;
  aToBRatio: string;
  bToARatio: string;
  tokenABalance: string;
  tokenBBalance: string;
  lpToken: {
    _name: string;
    _symbol: string;
    address: string;
    _totalSupply: string;
    balances?: Array<{ balance: string }>;
  };
  tokenA: {
    _name: string;
    _symbol: string;
    address: string;
  };
  tokenB: {
    _name: string;
    _symbol: string;
    address: string;
  };
  _name?: string;
  _symbol?: string;
}

export interface SwapHistoryEntry {
  id: string;
  timestamp: Date;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  impliedPrice: string;
  sender: string;
}

export interface PriceHistoryEntry {
  id: string;
  timestamp: Date;
  asset: string;
  price: string;
  blockTimestamp: Date;
}

export interface PriceHistoryResponse {
  data: PriceHistoryEntry[];
  totalCount: number;
}

export interface HealthImpactData {
  currentHealthFactor: number;
  newHealthFactor: number;
  healthImpact: number;
  isHealthy: boolean;
}

/*-------- Polling Interfaces --------*/

export interface PollingConfig {
  fetchFn: () => Promise<any>;
  shouldPoll?: (amount: string) => boolean;
  onDataUpdate?: (data: any) => void;
  interval?: number;
  autoStart?: boolean;
  transformData?: (data: any) => any;
  onError?: (error: any) => void;
  enabled?: boolean;
}

export interface PollingReturn {
  startPolling: () => void;
  stopPolling: () => void;
  isPolling: boolean;
  fetchData: () => Promise<any>;
  lastData: any;
  error: any;
}

export interface SwapPollingConfig {
  fromAsset?: any; 
  toAsset?: any; 
  fromAmount: string; 
  editingField: 'from' | 'to' | null;
  getPoolByTokenPair: (fromAddress: string, toAddress: string) => Promise<any>;
  calculateSwap: (params: any) => Promise<any>;
  setPool: (pool: any) => void; 
  setToAsset: (asset: any) => void; 
  setToAmount: (amount: string) => void; 
  setExchangeRate: (rate: string) => void;
  lastCalculatedFromRef: React.MutableRefObject<string>; 
  interval?: number;
}

// New interfaces for focused hooks
export interface PoolPollingConfig {
  fromAsset: any;
  toAsset: any;
  getPoolByTokenPair: (fromAddress: string, toAddress: string) => Promise<any>;
  setPool: (pool: any) => void;
  interval?: number;
}

export interface ExchangeRateConfig {
  poolData: any;
  fromAsset: any;
  setExchangeRate: (rate: string) => void;
}

export interface SwapCalculationConfig {
  poolData: any;
  fromAsset: any;
  fromAmount: string;
  editingField: 'from' | 'to' | null;
  calculateSwap: (params: any) => Promise<string>;
  setToAmount: (amount: string) => void;
  lastCalculatedFromRef: React.MutableRefObject<string>;
}

export interface SwapStateCleanupConfig {
  poolData: any;
  setToAsset: (asset: any) => void;
  setToAmount: (amount: string) => void;
  setExchangeRate: (rate: string) => void;
}