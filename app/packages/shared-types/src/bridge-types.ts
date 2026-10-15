import {TransactionResponse} from "./common-types";

// ============================================================================
// NETWORK CONFIG TYPES
// ============================================================================

/**
 * Network configuration from API response
 */
export interface NetworkConfig {
  externalChainId: number;
  chainInfo: {
    custody: string;
    enabled: boolean;
    chainName: string;
    depositRouter: string;
    lastProcessedBlock: string;
  };
}

// ============================================================================
// BRIDGE TOKEN TYPES
// ============================================================================

/**
 * Bridge token information
 */
export interface BridgeToken {
  id: string;
  routeType: BridgeRouteType;
  stratoToken: string;           // Key: address of the STRATO token
  stratoTokenName: string;       // From TokenFactory (not in AssetInfo)
  stratoTokenSymbol: string;     // From TokenFactory (not in AssetInfo)
  externalChainId: string;       // Matches AssetInfo.externalChainId
  externalBridge?: string;       // Native-only representation bridge address
  externalName: string;          // Matches AssetInfo.externalName
  externalToken: string;         // Matches AssetInfo.externalToken
  externalSymbol: string;        // Matches AssetInfo.externalSymbol
  externalDecimals: string;      // Matches AssetInfo.externalDecimals
  maxPerWithdrawal: string;      // Matches AssetInfo.maxPerWithdrawal
  instantWithdrawalThreshold?: string; // Native-only; amount eligible for automatic instant bridge-out
  enabled: boolean;              // effective route enabled state
  depositsPaused?: boolean;      // Native-only; hides native redemption/deposit routes when true
  withdrawalsPaused?: boolean;   // Native-only; hides native withdrawal routes when true
  depositsDisabled?: boolean;    // Native-only; token-specific deposit control
  withdrawalsDisabled?: boolean; // Native-only; token-specific withdrawal control
  maxOutstandingWithdrawal?: string; // Native-only; aggregate custody cap, 0 means unlimited
  outstandingWithdrawal?: string; // Native-only; amount currently locked in custody
  remainingOutstandingWithdrawal?: string; // Native-only; available aggregate capacity
  isDefaultRoute: boolean;       // true when route token matches asset default token
  stratoTokenImage?: string;     // First image URL from TokenFactory images
  rebaseFactor?: string;         // External-only; for example, getCurrentMultiplier() for TSLAx
}

export type BridgeRouteType = "standard" | "native";

/**
 * A post-deposit action (earn yield or forge metal) returned by /bridge/depositActions
 */
export interface DepositAction {
  id: string;
  action: number;                // 2 = AUTO_FORGE, 3 = AUTO_SAVE
  stratoToken: string;           // final output token (metal or saveUSDST)
  stratoTokenSymbol: string;
  stratoTokenName: string;
  stratoTokenImage?: string;
  payToken: string;              // bridged route token supplied to the action
  externalChainIds: string[];    // chains whose DepositRouter major version is at least 3
  minimumRouterMajorVersion: number;
  psmFeeBps: string;             // zero for routes that mint USDST directly
  oraclePrice?: string;          // WAD-scaled price for estimated output calc
  /** Metal forge fee in basis points; AUTO_FORGE (action 2) only, from MetalForge metalConfigs */
  feeBps?: string;
}

// ============================================================================
// BRIDGE TRANSACTION TYPES
// ============================================================================

/**
 * Bridge transaction information
 */
export interface BridgeTransaction {
  block_timestamp: string;
  chainId?: number;
  from: string;
  to: string;
  amount: string;
  txHash?: string;
  token?: string;
  key?: string;
  depositStatus?: string;
  withdrawalStatus?: string;
  tokenSymbol?: string;
  ethTokenName?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
  // Enriched fields from bridge assets
  stratoToken?: string;
  stratoTokenName?: string;
  stratoTokenSymbol?: string;
  externalName?: string;
  externalSymbol?: string;
  externalToken?: string;
  // Deposit action outcome (only for deposits with AUTO_SAVE or AUTO_FORGE)
  depositOutcome?: "bridge" | "save" | "forge" | "fallback";
  finalToken?: string;
  finalTokenSymbol?: string;
  finalAmount?: string;
}

/**
 * Bridge transaction response with pagination
 */
export interface BridgeTransactionResponse {
  data: BridgeTransaction[];
  totalCount: number;
}

/**
 * Bridge transaction tab types
 */
export type BridgeTransactionTab = 'DepositRecorded' | 'WithdrawalInitiated' | 'RedemptionInitiated' | 'USDSTDeposit';

// ============================================================================
// BRIDGE WITHDRAWAL TYPES
// ============================================================================

/**
 * Parameters for requesting a withdrawal
 */
export interface WithdrawalRequestParams {
  routeType?: BridgeRouteType;
  externalChainId: string;
  externalRecipient: string;
  externalToken?: string;
  stratoToken: string;
  stratoTokenAmount: string;
}

/**
 * Response from withdrawal summary endpoint
 */
export interface WithdrawalSummaryResponse {
  totalWithdrawn30d: string;      // Total withdrawn in last 30 days in wei (string format)
  pendingWithdrawals: string;      // Pending withdrawals in wei (string format)
  availableToWithdraw: string;     // Available balance to withdraw in wei (string format)
}
