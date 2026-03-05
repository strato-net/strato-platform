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
  stratoToken: string;           // Key: address of the STRATO token
  stratoTokenName: string;       // From TokenFactory (not in AssetInfo)
  stratoTokenSymbol: string;     // From TokenFactory (not in AssetInfo)
  externalChainId: string;       // Matches AssetInfo.externalChainId
  externalName: string;          // Matches AssetInfo.externalName
  externalToken: string;         // Matches AssetInfo.externalToken
  externalSymbol: string;        // Matches AssetInfo.externalSymbol
  externalDecimals: string;      // Matches AssetInfo.externalDecimals
  maxPerWithdrawal: string;      // Matches AssetInfo.maxPerWithdrawal
  bridgeable: boolean;           // true if stratoToken !== USDST, false otherwise
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
 * Parameters for requesting automatic supply of liquidity
 * to the lending pool upon deposit completion
 */
export interface AutoSaveRequestParams {
  externalChainId: string;
  externalTxHash: string;
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