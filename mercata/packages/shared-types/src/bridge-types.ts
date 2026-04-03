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
    vaultAddress?: string;          // ExternalBridgeVault address (replaces custody for new flow)
    repBridgeAddress?: string;      // StratoRepresentationBridge address (for STRATO-native asset bridging)
  };
}

// ============================================================================
// BRIDGE TOKEN TYPES
// ============================================================================

/**
 * Bridge token information
 */
/**
 * Asset family classification.
 * - "external-canonical": native to external chains (USDC, ETH, WBTC) — lock on external, mint on STRATO
 * - "strato-canonical": native to STRATO (USDST, GOLDST, SILVST) — lock on STRATO, mint representation on external
 */
export type AssetFamily = "external-canonical" | "strato-canonical";

export interface BridgeToken {
  id: string;
  stratoToken: string;           // Key: address of the STRATO token
  stratoTokenName: string;       // From TokenFactory (not in AssetInfo)
  stratoTokenSymbol: string;     // From TokenFactory (not in AssetInfo)
  externalChainId: string;       // Matches AssetInfo.externalChainId
  externalName: string;          // Matches AssetInfo.externalName
  externalToken: string;         // Matches AssetInfo.externalToken
  externalSymbol: string;        // Matches AssetInfo.externalSymbol
  externalDecimals: string;      // Matches AssetInfo.externalDecimals
  maxPerWithdrawal: string;      // Matches AssetInfo.maxPerWithdrawal
  enabled: boolean;              // effective route enabled state
  isDefaultRoute: boolean;       // true when route token matches asset default token
  isNative: boolean;             // true for STRATO-canonical assets (USDST, GOLDST, SILVST)
  assetFamily: AssetFamily;      // asset family classification
  stratoTokenImage?: string;     // First image URL from TokenFactory images
  rebaseFactor?: string;         // External-only; for example, getCurrentMultiplier() for TSLAx
}

/**
 * A post-deposit action (earn yield or forge metal) returned by /bridge/depositActions
 */
export interface DepositAction {
  id: string;
  action: number;                // 1 = AUTO_SAVE, 2 = AUTO_FORGE
  stratoToken: string;           // output token address (mToken for earn, metal for forge)
  stratoTokenSymbol: string;
  stratoTokenName: string;
  stratoTokenImage?: string;
  payToken: string;              // STRATO pay token this applies to (join key to match VIA MINT routes)
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
  depositOutcome?: "bridge" | "save" | "forge";
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
  externalChainId: string;
  externalRecipient: string;
  externalToken: string;
  stratoToken: string;
  stratoTokenAmount: string;
}

/**
 * Parameters for requesting a post-deposit action (auto-save, auto-forge, etc.)
 * @param action - Deposit action type (1 = AUTO_SAVE, 2 = AUTO_FORGE)
 * @param targetToken - Action-specific target token (e.g. metal token address for AUTO_FORGE, unused for AUTO_SAVE)
 */
export interface DepositActionRequestParams {
  externalChainId: string;
  externalTxHash: string;
  action: number;
  targetToken?: string;
}

/**
 * Response from withdrawal summary endpoint
 */
export interface WithdrawalSummaryResponse {
  totalWithdrawn30d: string;      // Total withdrawn in last 30 days in wei (string format)
  pendingWithdrawals: string;      // Pending withdrawals in wei (string format)
  availableToWithdraw: string;     // Available balance to withdraw in wei (string format)
}

// ============================================================================
// WITHDRAWAL STATUS TYPES
// ============================================================================

/**
 * Internal detailed withdrawal status used by the bridge service.
 */
export type DetailedWithdrawalStatus =
  | "Requested"
  | "PendingLiquidity"
  | "Ready"
  | "Executing"
  | "Completed"
  | "Cancelled"
  | "Expired"
  | "Rejected"
  | "FailedRecoverable"
  | "FailedPostExecution";

/**
 * Simplified user-facing withdrawal status.
 */
export type SimpleWithdrawalStatus =
  | "Pending"
  | "Processing"
  | "Completed"
  | "Failed"
  | "Cancelled";

/**
 * Map internal detailed status to user-facing simple status.
 */
export function toSimpleStatus(
  detailed: DetailedWithdrawalStatus,
): SimpleWithdrawalStatus {
  switch (detailed) {
    case "Requested":
    case "PendingLiquidity":
    case "Ready":
      return "Pending";
    case "Executing":
      return "Processing";
    case "Completed":
      return "Completed";
    case "Cancelled":
    case "Expired":
      return "Cancelled";
    case "Rejected":
    case "FailedRecoverable":
    case "FailedPostExecution":
      return "Failed";
  }
}

// ============================================================================
// CRYPTO CREDIT CARD CONFIG
// ============================================================================

/**
 * Per-card crypto credit card configuration (stored by backend, used by balance watcher).
 * A user can have multiple cards (multiple configs).
 */
export interface CreditCardConfig {
  id: string;                      // Unique card id (set by backend on create)
  userAddress: string;            // STRATO address
  nickname?: string;              // User-defined nickname for the card (displayed on card)
  providerId?: string;            // Card provider id (e.g. "metamask-card", "etherfi-card") for correct logo
  destinationChainId: string;      // External chain id (numeric string)
  cardWalletAddress: string;       // Card wallet on destination chain
  externalToken: string;           // External token address on destination chain (e.g. USDC)
  thresholdAmount: string;         // Top up when balance below this (wei string)
  topUpAmount: string;            // Amount to bridge per top-up (wei string)
  useBorrow: boolean;              // If true, borrow USDST against collateral then bridge (v1 may be no-op)
  checkFrequencyMinutes: number;  // How often to check balance
  cooldownMinutes: number;        // Min minutes between top-ups
  enabled: boolean;
  lastTopUpAt?: string;           // ISO timestamp
  lastCheckedAt?: string;
  lastError?: string;
}

/**
 * Params for executing a single top-up (operator-only).
 */
export interface CreditCardTopUpExecuteParams {
  userAddress: string;
  stratoTokenAmount: string;
  externalChainId: string;
  externalRecipient: string;
  externalToken: string;
}
