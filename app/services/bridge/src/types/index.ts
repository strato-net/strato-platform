// ---------------- Utility Types ----------------
export type NonEmptyArray<T> = [T, ...T[]];

// ---------------- Transaction Types ----------------
export type TxPayloadArgs = Record<string, any>;

export interface FunctionTx {
  payload: {
    contractName: string;
    contractAddress: string;
    method: string;
    args: TxPayloadArgs;
  };
  type: "FUNCTION";
}

export interface BuiltTx {
  txs: FunctionTx[];
  txParams: {
    gasLimit: number;
    gasPrice: number;
  };
}

export interface FunctionInput {
  contractName: string;
  contractAddress: string;
  method: string;
  args: TxPayloadArgs;
}

// ---------------- Strato Helper Types ----------------
export interface TxResult {
  status: string;
  hash: string;
  txResult?: { message?: string };
  error?: string;
  message?: string;
}

// execute() only resolves once every posted transaction succeeded; anything else throws
export interface TxResponse {
  status: "Success";
  hash: string;
}

// ---------------- API Types ----------------
export interface RetryConfig {
  maxAttempts?: number;
  logPrefix?: string;
}

export interface ClientOptions {
  authenticated?: boolean;
  timeout?: number;
  logPrefix?: string;
}

export interface ApiClient {
  get<T = any>(url: string, config?: any): Promise<T>;
  post<T = any>(url: string, data?: any, config?: any): Promise<T>;
}

// ---------------- Safe Service Types ----------------
export type TxType = "eth" | "erc20";

export interface SafeTransactionResult {
  safeTxHash: string;
}

// Clear types for Safe transaction data
export interface SafeTransactionData {
  withdrawalId: string;
  // Tags the payout with its withdrawal on the Safe Transaction Service
  origin: string;
  safeAddress: string;
  safeTransactionData: any;
  safeTxHash: string;
  senderAddress: string;
  senderSignature: any;
  nonce: number;
  externalChainId: number;
  isHot: boolean;
}

export interface PreparedWithdrawal {
  externalTokenAmount: string;
  externalRecipient: string;
  type: TxType;
  externalToken: string;
  externalChainId: number;
  withdrawalId: string;
}

export interface DepositArgs {
  externalChainId: string | number;
  externalSender: string;
  externalToken: string;
  externalTokenAmount: string;
  externalTxHash: string;
  stratoRecipient: string;
  targetStratoToken: string;
}

/**
 * The solver fee schedule a request committed to on its ORIGIN chain.
 *
 * `requestedAt` is the origin chain's timestamp, and passing it through
 * unchanged is the whole point: STRATO measures the fee decay from when the
 * user actually asked, so relayer lag is refunded to the user rather than
 * pocketed by a solver. Never substitute a local clock for it.
 */
export interface FeeTerms {
  maxFee: string;
  requestedAt: string;
  feeHalfLife: string;
}

export type FeeDepositArgs = DepositArgs & FeeTerms;

export interface ActionDepositArgs extends DepositArgs {
  action: string;
  actionToken: string;
  minFinalOut: string;
}

// One DepositRouted / DepositRoutedWithAction / DepositRoutedWithFee event, ready to record on STRATO.
// A "fee" deposit carries the schedule it committed to on its origin chain; the others carry zeros.
export interface WindowDeposit extends ActionDepositArgs, FeeTerms {
  kind: "standard" | "action" | "fee";
  depositId: string; // router-assigned, sequential per router
  // STRATO deposit key: the tx hash, or `${txHash}#${depositId}` when the tx emitted several deposits
  depositKey: string;
  sharesTransaction: boolean;
  blockNumber: number;
  logIndex: number;
}

export interface ConfirmDepositArgs {
  externalChainId: string | number;
  externalTxHash: string;
  stratoRecipient: string;
  verified: boolean;
}

export interface NativeDepositArgs {
  externalChainId: string | number;
  externalBridge: string;
  externalRedemptionId: string | number;
  externalSender: string;
  representationToken: string;
  externalTxHash: string;
  stratoRecipient: string;
  stratoTokenAmount: string;
  /// Present only for a redemption that offered a solver fee.
  feeTerms?: FeeTerms;
}

/**
 * A solver's claim on a STRATO withdrawal, read off the external chain's
 * WithdrawalFilled log and mirrored back to STRATO.
 *
 * Mirroring does not pay the solver -- the external chain's own settlement does
 * that. It makes the claim visible on the chain holding the escrow, and it
 * closes the user's abort hatch: without it a user could take a solver's tokens
 * on one chain and their own escrow back on the other.
 */
export interface WithdrawalClaimArgs {
  withdrawalId: string;
  externalChainId: string | number;
  claimant: string;
  claimIndex: number;
  feeCharged: string;
  netPaid: string;
  claimedAt: string;
  externalFillTxHash: string;
}

export interface ConfirmNativeDepositArgs {
  externalChainId: string | number;
  externalBridge: string;
  externalRedemptionId: string | number;
  depositId: string;
  stratoRecipient: string;
  verified: boolean;
}

export interface DepositInfo {
  bridgeStatus: string; // 0 NONE, 1 INITIATED, 2 PENDING_REVIEW, 3 COMPLETED, 4 ABORTED, 5 SWEPT, 6 QUARANTINED, 7 ANNOUNCED
  externalSender: string;
  externalToken: string;
  requestedAt: string;
  stratoRecipient: string;
  stratoToken: string;
  stratoTokenAmount: string;
  timestamp: string;

  externalChainId: string | number;
  externalTxHash: string;
  externalDecimals: number;
  depositRouter: string;
}

export interface NativeDepositInfo {
  bridgeStatus: string;
  depositId: string;
  externalBridge: string;
  externalSender: string;
  externalTxHash: string;
  externalChainId: string | number;
  externalRedemptionId: string | number;
  representationToken: string;
  requestedAt: string;
  stratoRecipient: string;
  stratoToken: string;
  stratoTokenAmount: string;
  timestamp: string;
}


export interface WithdrawalInfo {
  bridgeStatus: string; // NONE / INITIATED / COMPLETED / ABORTED
  custodyTxHash: string;
  externalChainId: string | number;
  externalRecipient: string;
  externalToken: string;
  externalTokenAmount: string;
  requestedAt: string;
  stratoSender: string;
  stratoToken: string;
  stratoTokenAmount: string;
  timestamp: string;

  withdrawalId: string;
  useHotWallet?: boolean;

  /// Committed at request time; needed to build the static settlement payload
  /// and to check a solver's claimed fee. Absent on pre-upgrade withdrawals.
  feeTerms?: FeeTerms;

  /// Set by the relayer before proposing, not read from Cirrus: the STRATO
  /// network and bridge this withdrawal came from, and the external-chain
  /// router that will route the payout. All three are needed to build the
  /// static settlement payload; without them the proposal falls back to a
  /// direct transfer to the recipient, which is what pre-upgrade withdrawals
  /// still need.
  sourceChainId?: string;
  sourceBridge?: string;
  settlementRouter?: string;
}

export interface NativeWithdrawalInfo {
  bridgeStatus: string;
  externalTxHash: string;
  externalChainId: string | number;
  externalBridge: string;
  externalRecipient: string;
  representationToken: string;
  externalTokenAmount: string;
  requestedAt: string;
  stratoSender: string;
  stratoToken: string;
  stratoTokenAmount: string;
  timestamp: string;
  nativeMintProposalHash?: string;
  nativeMintNotBefore?: string;
  useInstantPath?: boolean;

  withdrawalId: string;

  /// Committed at request time; copied into the V2 mint attestation so the
  /// destination chain can check a solver's claim against what the user agreed
  /// to. Absent on pre-upgrade withdrawals.
  feeTerms?: FeeTerms;
}

export interface ChainInfo {
  externalChainId: number;
  depositRouter: string;
  lastProcessedBlock: number;
  enabled: boolean;
  custody: string;
  chainName: string;
}

export interface AssetInfo {
  enabled: boolean;
  stratoToken: string;
  externalName: string;
  externalToken: string;
  externalSymbol: string;
  externalChainId: number;
  externalDecimals: number;
  maxPerWithdrawal: number;
}

export interface BridgeInfo {
  DECIMAL_PLACES: number;
  USDST_ADDRESS: string;
  WITHDRAWAL_ABORT_DELAY: number;
  _owner: string;
  depositsPaused: boolean;
  tokenFactory: string;
  withdrawalCounter: number;
  withdrawalsPaused: boolean;
}
