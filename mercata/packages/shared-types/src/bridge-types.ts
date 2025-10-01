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
  stratoToken: string;           // Key: address of the STRATO token
  stratoTokenName: string;       // From TokenFactory (not in AssetInfo)
  stratoTokenSymbol: string;     // From TokenFactory (not in AssetInfo)
  externalChainId: string;       // Matches AssetInfo.externalChainId
  permissions: number;           // Matches AssetInfo.permissions
  externalName: string;          // Matches AssetInfo.externalName
  externalToken: string;         // Matches AssetInfo.externalToken
  externalSymbol: string;        // Matches AssetInfo.externalSymbol
  externalDecimals: string;      // Matches AssetInfo.externalDecimals
  maxPerTx: string;              // Matches AssetInfo.maxPerTx
}

// ============================================================================
// BRIDGE TRANSACTION TYPES
// ============================================================================

/**
 * Bridge transaction information
 */
export interface BridgeTransaction {
  transaction_hash: string;
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
  stratoToken: string;
  stratoTokenAmount: string;
  externalRecipient: string;
}

/**
 * Response from withdrawal request
 */
export interface WithdrawalRequestResponse {
  status: string;
  hash: string;
  message: string;
}