// ============================================================================
// Config Types
// ============================================================================

export interface AuthConfig {
  openIdDiscoveryUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface NodeConfig {
  name: string;
  url: string;
  auth: AuthConfig;
}

export interface GasConfig {
  limit: number;
  price: number;
}

export interface PollingConfig {
  interval: number;
  timeout: number;
}

export type SubmitMode = "sequential" | "pipeline";

export interface ContractDeployScenarioConfig {
  enabled: boolean;
  batchSize: number;
  batchCount: number;
  batchDelay: number;
  submitMode: SubmitMode;
  contractSource: string;
  contractName: string;
  contractArgs: Record<string, any>;
}

export interface FunctionCallScenarioConfig {
  enabled: boolean;
  batchSize: number;
  batchCount: number;
  batchDelay: number;
  submitMode: SubmitMode;
  setupContract: string;
  contractName: string;
  method: string;
  args: Record<string, any>;
}

export interface MixedWorkloadScenarioConfig {
  enabled: boolean;
  deployRatio: number;
  totalTxCount: number;
  batchSize: number;
  submitMode: SubmitMode;
}

export interface MultiNodeConfig {
  enabled: boolean;
}

// ----------------------------------------------------------------------------
// Token Sale TPS scenario (Scenario 1)
// ----------------------------------------------------------------------------
// This scenario replays the "Fund > Bridge-In (Ethereum → STRATO, USDC →
// GOLDST)" composition that the Mercata UI performs at /dashboard/deposits.
// It is a two-step sequence against mercata/backend:
//   1. POST /api/bridge/requestDepositAction (action = 2 AUTO_FORGE)
//   2. POST /api/metal-forge/buy (USDST → metal on STRATO)
// Plus a set of warm-up GETs that the Fund page issues on mount. The on-chain
// Ethereum side (Permit2 + DepositRouter.deposit) is NOT replayed per
// iteration because it burns real gas and real blocktime; configure a real
// externalTxHash to reuse, or leave blank to skip the bridge request.
// ----------------------------------------------------------------------------

export interface TokenSaleUser {
  username: string;
  password: string;
}

/** Post-deposit action codes used by /api/bridge/requestDepositAction. */
export type BridgeDepositAction = 1 | 2; // 1=AUTO_SAVE (lend USDST), 2=AUTO_FORGE (buy metal)

/**
 * Inline Sepolia broadcaster config for the tokenSale scenario. When set,
 * each iteration broadcasts a real `DepositRouter.depositETH(...)` on Sepolia
 * with a sequential nonce, takes the resulting tx hash, and uses it as the
 * `externalTxHash` of the per-iteration POST /api/bridge/requestDepositAction.
 * This is functionally Scenario 4's flow run inline as the first leg of
 * Scenario 1 — so every iteration represents a UNIQUE bridge entry.
 */
export interface TokenSaleBridgeConfig {
  /** Sepolia (or any external EVM testnet) JSON-RPC URL. */
  sepoliaRpcUrl: string;
  /** Funded EOA private key (0x-prefixed). Needs N × amountPerTx + N × gas. */
  sepoliaPrivateKey: string;
  /** DepositRouter contract on the external chain (0x-prefixed). */
  depositRouterAddress: string;
  /** Recipient STRATO address (hex, with or without 0x). */
  stratoRecipientAddress: string;
  /** Corresponding STRATO-side token address (hex, with or without 0x). */
  targetStratoToken: string;
  /** Amount sent per bridge in wei (default 0.000001 ETH = "1000000000000"). */
  amountPerTx?: string;
  /** External chain ID. Defaults to 11155111 (Sepolia). */
  chainId?: number;
  /** If true, await Sepolia receipt before posting the bridge request.
   *  Default false — Sepolia confirmation takes ~12 s, awaiting per iteration
   *  blocks the loop. With false, the hash goes into the bridge request
   *  immediately even though the tx is not yet mined. */
  awaitConfirmation?: boolean;
  /** Override the starting nonce (default: read from chain at init). */
  startNonce?: number;
  /** Gas-tx overrides. Defaults: 250000 / 30 / 2. */
  gasLimit?: number;
  maxFeePerGasGwei?: number;
  maxPriorityFeePerGasGwei?: number;
}

/**
 * Granularity for token-balance logging during a tokenSale run.
 *  - "none"    – never read balances (max throughput)
 *  - "summary" – read once before and once after the run, log the deltas
 *  - "perStep" – read before and after every single iteration (slow, full
 *                visibility — adds ~6 extra GETs of overhead per sale call)
 */
export type BalanceLoggingMode = "none" | "summary" | "perStep";

export interface TokenSaleScenarioConfig {
  enabled: boolean;
  /** Backend URL (e.g. https://app.testnet.strato.nexus). Defaults to node[0].url. */
  backendUrl?: string;
  /** Total number of sales (bridge+forge or buy-metal pairs) to execute. */
  totalTxCount: number;
  /** Target time window in milliseconds (1000 sales / 30s = 30000). */
  timeWindowMs: number;
  /** Number of concurrent virtual users submitting sales. */
  concurrentUsers: number;
  /** Network identifier label, e.g. "helium". Used only for report metadata. */
  networkLabel?: string;
  /** STRATO chain ID (e.g. 114784819836269 for helium testnet). Used for metadata. */
  chainId?: string | number;

  /* ---- Bridge-in phase (POST /api/bridge/requestDepositAction) ---- */
  /** External chain ID string the deposit originates on (e.g. "1" Ethereum, "11155111" Sepolia). */
  externalChainId?: string;
  /** Reusable external tx hash. If empty AND `bridge` is unset, the bridge
   *  request leg is skipped. Used only when `bridge` is NOT configured —
   *  when `bridge` is set, a fresh hash is broadcast per iteration. */
  externalTxHash?: string;
  /** Post-deposit action (2 = AUTO_FORGE metal). */
  action?: BridgeDepositAction;
  /** Optional inline bridge-broadcast config — when set (and skipBridgeRequest
   *  is false), each iteration first broadcasts a fresh DepositRouter.depositETH
   *  on Sepolia (sequential nonce per iteration) before posting the bridge
   *  request. This integrates Scenario 4's flow as a third leg of Scenario 1
   *  so every iteration represents a UNIQUE bridge entry. */
  bridge?: TokenSaleBridgeConfig;

  /* ---- Buy-metal phase (POST /api/metal-forge/buy) ---- */
  /** Metal token address on STRATO (hex, no 0x). E.g. GOLDST. */
  metalTokenAddress: string;
  /** Pay token address on STRATO (hex, no 0x). E.g. USDST. */
  payTokenAddress: string;
  /** Pay amount in 18-decimal wei string. */
  payAmount: string;
  /** Minimum metal output in wei (slippage guard). */
  minMetalOut: string;

  /* ---- Behaviour toggles ---- */
  /** If true, do the Fund-page warm-up GETs once per user before hitting the POSTs. */
  includePageLoad?: boolean;
  /** If true, only perform the buy-metal step (skip /bridge/requestDepositAction). */
  skipBridgeRequest?: boolean;
  /** If true, only perform the bridge-request step (skip /metal-forge/buy). */
  skipBuyMetal?: boolean;
  /**
   * If true, run the legs in a TWO-PHASE pipeline instead of the default
   * per-worker-sequential mode:
   *   Phase 1: broadcast all N Sepolia deposits in parallel (bounded by
   *            sepoliaConcurrency, defaults to concurrentUsers).
   *   Phase 2: for each successful broadcast, fire bridgeRequest + buyMetal
   *            in parallel (bounded by backendConcurrency, defaults to
   *            concurrentUsers).
   * Wall-clock becomes max(slowest broadcast) + max(slowest backend round-
   * trip) instead of N × per-iteration time.
   * Note: pipelineMode disables per-iteration rate-limiting (timeWindowMs is
   * ignored within phases — phases run as fast as the concurrency allows).
   */
  pipelineMode?: boolean;
  /** Override concurrency for the broadcast phase under pipelineMode.
   *  Default: cfg.concurrentUsers. */
  sepoliaConcurrency?: number;
  /** Override concurrency for the bridgeRequest+buyMetal phase under
   *  pipelineMode. Default: cfg.concurrentUsers. */
  backendConcurrency?: number;

  /**
   * Max retries for transient HTTP errors (429 + any 5xx) on the bridgeRequest
   * and buyMetal legs. Default 3. Backoff between attempts is exponential with
   * jitter: 1500*2^k + random(0..500) ms, so attempts are spaced
   *   ~1.5s, ~3s, ~6s
   * after the initial try (max ~10.5s of total retry-wait at the worst case).
   * Retried iterations record a single metric whose `submitDuration` is the
   * end-to-end wall clock including the wait windows.
   */
  requestRetries?: number;

  /* ---- Balance logging ---- */
  /** How aggressively to capture token-balance transitions. Default "none"
   *  (preserves pre-feature throughput). Set to "summary" for run-level
   *  before/after, or "perStep" for per-iteration before/after. */
  logBalances?: BalanceLoggingMode;
  /** MetalForge contract address on STRATO (hex, with or without 0x). Used to
   *  read counterparty / treasury balances via Cirrus. Defaults to the helium
   *  testnet MetalForge (c5ed981b816a626981a5747d125e0e7296b2c7c6). */
  metalForgeAddress?: string;

  /* ---- Auth ---- */
  /** Optional list of pre-provisioned user credentials. Falls back to node[0] auth. */
  users?: TokenSaleUser[];
  /** Optional OpenID discovery URL for user auth (falls back to node[0].auth). */
  openIdDiscoveryUrl?: string;
  /** Optional OAuth client id / secret for user auth. */
  clientId?: string;
  clientSecret?: string;
}

// ----------------------------------------------------------------------------
// JSON-RPC stress scenario (Scenario 2)
// ----------------------------------------------------------------------------

export interface JsonRpcMethodSpec {
  method: string;
  /** Weight for random selection (higher = more frequent). */
  weight?: number;
  /** Static params. If omitted a sensible default is generated. */
  params?: any[];
}

export interface JsonRpcStressScenarioConfig {
  enabled: boolean;
  /** Full RPC URL (e.g. https://app.testnet.strato.nexus/rpc/114784819836269). */
  rpcUrl: string;
  /** Number of concurrent virtual users. */
  concurrentUsers: number;
  /** Duration in ms each user runs for. */
  durationMs: number;
  /** Optional per-user delay between calls (ms). */
  thinkTimeMs?: number;
  /** Methods to rotate through. If empty, a built-in default set is used. */
  methods?: JsonRpcMethodSpec[];
  /** If true each request uses the node[0] bearer token. */
  authenticated?: boolean;
}

// ----------------------------------------------------------------------------
// Full application simulation (Scenario 3)
// ----------------------------------------------------------------------------

export interface FullAppWorkflowStep {
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Path templated with {placeholders} interpolated from the user's context. */
  path: string;
  /** If true, include Authorization: Bearer header. */
  auth?: boolean;
  /** Optional JSON body (POST/PUT). */
  body?: any;
  /** Optional query parameters. */
  query?: Record<string, string | number | boolean>;
  /** Optional think time before this step (ms). */
  thinkTimeMs?: number;
}

export interface FullAppScenarioConfig {
  enabled: boolean;
  /** Base URL (e.g. https://app.testnet.strato.nexus). */
  baseUrl: string;
  /** Number of concurrent virtual users. */
  concurrentUsers: number;
  /** Total test duration in ms. */
  durationMs: number;
  /** Iterations of the workflow per user (if omitted, loops for durationMs). */
  iterationsPerUser?: number;
  /** Ordered workflow steps. If empty uses built-in default. */
  workflow?: FullAppWorkflowStep[];
  /** Optional list of user credentials. */
  users?: TokenSaleUser[];
  /** Fallback auth fields. */
  openIdDiscoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

// ----------------------------------------------------------------------------
// Sepolia → STRATO bridge-in scenario (Scenario 4)
// ----------------------------------------------------------------------------

export interface BridgeInScenarioConfig {
  enabled: boolean;
  /** Number of bridge-in transactions to execute. */
  totalBridgeIns: number;
  /** Time window within which to submit them (ms). */
  timeWindowMs: number;
  /** Sepolia chain ID (11155111). */
  sepoliaChainId: number;
  /** Sepolia JSON-RPC URL (Infura/Alchemy/etc). */
  sepoliaRpcUrl: string;
  /** Private key of the funded Sepolia account signing the deposits (0x-prefixed). */
  sepoliaPrivateKey: string;
  /** DepositRouter contract address on Sepolia (0x-prefixed). */
  depositRouterAddress: string;
  /** Mode: "ETH" uses depositETH (no approval needed); "ERC20" uses deposit. */
  depositMode?: "ETH" | "ERC20";
  /** Sepolia ERC20 token address for ERC20 mode. */
  sepoliaTokenAddress?: string;
  /** Amount per bridge-in (wei string). For ETH: value sent. For ERC20: token amount. */
  amountPerTx: string;
  /** Recipient address on STRATO (hex, no 0x). */
  stratoRecipientAddress: string;
  /** Corresponding STRATO-side token address (hex, no 0x). */
  targetStratoToken: string;
  /** STRATO backend URL (used for post-bridge verification/minting checks). */
  stratoBackendUrl?: string;
  /** If true, wait for each Sepolia tx to be mined before sending next. */
  awaitSepoliaConfirmation?: boolean;
  /** Max seconds to wait for STRATO-side confirmation (mint) after Sepolia tx confirms. */
  stratoConfirmTimeoutSec?: number;
  /** Starting nonce override — if omitted, read from chain. */
  startNonce?: number;
  /** Gas limit override for deposit tx (default 250000). */
  gasLimit?: number;
  /** Max fee per gas in gwei. */
  maxFeePerGasGwei?: number;
  /** Max priority fee per gas in gwei. */
  maxPriorityFeePerGasGwei?: number;
}

export interface ScenariosConfig {
  contractDeploy: ContractDeployScenarioConfig;
  functionCall: FunctionCallScenarioConfig;
  mixedWorkload: MixedWorkloadScenarioConfig;
  multiNode: MultiNodeConfig;
  tokenSale: TokenSaleScenarioConfig;
  jsonRpcStress: JsonRpcStressScenarioConfig;
  fullApp: FullAppScenarioConfig;
  bridgeIn: BridgeInScenarioConfig;
}

export interface ReportConfig {
  outputDir: string;
  formats: ("json" | "html")[];
}

export interface LoadTestConfig {
  nodes: NodeConfig[];
  gas: GasConfig;
  polling: PollingConfig;
  scenarios: ScenariosConfig;
  report: ReportConfig;
}

// ============================================================================
// Transaction Types
// ============================================================================

export interface TxPayload {
  contract?: string;
  contractName?: string;
  src?: string;
  args?: Record<string, any>;
  contractAddress?: string;
  method?: string;
}

export interface BuiltTx {
  txs: Array<{
    type: "CONTRACT" | "FUNCTION" | "TRANSFER";
    payload: TxPayload;
  }>;
  txParams: {
    gasLimit: number;
    gasPrice: number;
  };
}

export interface TxSubmitResponse {
  hash: string;
  status?: string;
  txResult?: { message?: string; contractsCreated?: string[] };
  error?: string;
  message?: string;
}

export interface TxResultResponse {
  status: "Success" | "Pending" | "Failure";
  hash: string;
  txResult?: {
    message?: string;
    contractsCreated?: string[];
  };
  error?: string;
  message?: string;
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface TxMetric {
  txHash: string;
  nodeName: string;
  scenario: string;
  batchIndex: number;
  submitTime: number;
  submitDuration: number;
  confirmTime?: number;
  confirmDuration?: number;
  totalDuration?: number;
  status: "submitted" | "confirmed" | "failed" | "timeout";
  error?: string;
}

export interface BatchMetric {
  batchIndex: number;
  nodeName: string;
  scenario: string;
  txCount: number;
  submitStart: number;
  submitEnd: number;
  submitDuration: number;
  confirmEnd?: number;
  confirmDuration?: number;
  totalDuration?: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
}

// ============================================================================
// Stats Types
// ============================================================================

export interface PercentileStats {
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface ScenarioStats {
  scenario: string;
  nodeName: string;
  totalTxCount: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  errorRate: number;
  submitLatency: PercentileStats;
  confirmLatency: PercentileStats;
  totalLatency: PercentileStats;
  submitTps: number;
  confirmedTps: number;
  startTime: number;
  endTime: number;
  wallClockDuration: number;
}

export interface TimelineBucket {
  timestamp: number;
  submitted: number;
  confirmed: number;
  failed: number;
}

// ============================================================================
// Report Types
// ============================================================================

export interface LoadTestReport {
  timestamp: string;
  config: {
    nodes: string[];
    gas: GasConfig;
    polling: PollingConfig;
  };
  scenarioStats: ScenarioStats[];
  timeline: TimelineBucket[];
  transactions: TxMetric[];
  batches: BatchMetric[];
  errors: Array<{ txHash: string; nodeName: string; scenario: string; error: string }>;
}

// ============================================================================
// Scenario Types
// ============================================================================

export interface ScenarioResult {
  scenario: string;
  nodeName: string;
  transactions: TxMetric[];
  batches: BatchMetric[];
}

// ============================================================================
// API Types
// ============================================================================

export interface ApiClient {
  get<T = any>(url: string): Promise<T>;
  post<T = any>(url: string, data?: any): Promise<T>;
}
