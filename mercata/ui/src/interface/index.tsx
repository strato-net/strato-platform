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
  collection_name?: string;
  collection_type?: string;
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
  "BlockApps-ERC20"?: {
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

/*-------- Withdraw Interfaces --------*/
export interface RawWithdrawData {
  withdrawalId: number;
  WithdrawalInfo: {
    externalChainId: string;
    externalRecipient: string;
    stratoToken: string;
    stratoTokenAmount: string;
    stratoSender: string;
    bridgeStatus: string;
    mintUSDST: boolean;
    timestamp: string;
    requestedAt: string;
  };
  // Backend enriched fields
  status: string;
  stratoToken: string;
  stratoTokenName: string;
  stratoTokenSymbol: string;
  externalName: string;
  externalSymbol: string;
  externalToken: string;
  // Database fields
  block_timestamp: string;
  transaction_hash: string;
}

export interface RawDepositData {
  externalChainId: string;
  externalTxHash: string;
  DepositInfo: {
    stratoToken: string;
    stratoRecipient: string;
    stratoTokenAmount: string;
    externalSender: string;
    bridgeStatus: string;
    mintUSDST: boolean;
    timestamp: string;
  };
  // Backend enriched fields
  status: string;
  stratoToken: string;
  stratoTokenName: string;
  stratoTokenSymbol: string;
  externalName: string;
  externalSymbol: string;
  externalToken: string;
  // Database fields
  block_timestamp: string;
  transaction_hash: string;
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
  maxBorrowingPower: string; // Borrowing power from supplied collateral (collateralizedAmount * price * ltv)
  unsuppliedBorrowingPower: string; // Potential borrowing power from user balance (userBalance * price * ltv)
  unsuppliedLTCollateralValue: string; // LT-weighted value of unsupplied balance (userBalance * price * lt)
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
  isPaused: boolean;              // LendingPool pause status
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
  userBalanceStaked?: string; // Staked balance from RewardsChef
  userBalanceTotal?: string; // Total = wallet + staked
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
  isPaused: boolean;              // LendingPool pause status
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
  perSecondFactorRAY: string;
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

// Export all swap-related types from dedicated swap interface
export * from './swap';

export type NewLoanData = {
  totalAmountOwed: string;             // current debt (index-based)
  totalAmountOwedPreview?: string;     // projected debt (optional)
  exchangeRate?: string;               // 1e18 (optional, if you surface it here)
  lastUpdated?: string;
  healthFactor: number;
  healthFactorRaw: string;
  totalBorrowingPowerUSD: string;
  totalCollateralValueUSD: string;      // risk-adjusted by LT (for health factor)
  totalCollateralValueSupplied: string; // full supplied collat $ value (for display)
  maxAvailableToBorrowUSD: string;
  interestRate: number;                // bps
  isAboveLiquidationThreshold: boolean;
  id?: string;
  maxRepay?: string;
  assetSymbol?: string;
};
export interface ApprovedToken {
  token: string;
  _name: string;
  _symbol: string;
}

// Re-export oracle types from shared-types package
export type { PriceHistoryEntry, PriceHistoryResponse } from '@mercata/shared-types';

export interface HealthImpactData {
  currentHealthFactor: number;
  newHealthFactor: number;
  healthImpact: number;
  isHealthy: boolean;
}

/*-------- Polling Interfaces --------*/

export interface PollingConfig {
  fetchFn: (signal: AbortSignal) => Promise<any>;
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

export interface PoolPollingConfig {
  fromAsset: any;
  toAsset: any;
  getPoolByTokenPair: (tokenA: string, tokenB: string, signal?: AbortSignal) => Promise<any>;
  fetchUsdstBalance: (signal?: AbortSignal) => Promise<void>;
  interval?: number;
}

export interface SafetyModuleData {
  totalAssets: string;
  totalShares: string;
  userShares: string;
  userSharesStaked: string;
  userSharesTotal: string;
  userCooldownStart: string;
  cooldownSeconds: string;
  unstakeWindow: string;
  exchangeRate: string;
  canRedeem: boolean;
  cooldownActive: boolean;
  cooldownTimeRemaining: string;
  unstakeWindowTimeRemaining: string;
  maxRedeemable: string;
  maxRedeemableTotal: string;
  redeemValue: string;
  redeemValueTotal: string;
}