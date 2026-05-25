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
// Application-layer scenario building blocks
// ----------------------------------------------------------------------------
// Two scenarios share these:
//   - tokenSale  (Scenario 1): canonical Mercata Bridge-In flow.
//                Sign Permit2 + broadcast DepositRouter.deposit on Sepolia,
//                then POST /api/bridge/requestDepositAction (action=2
//                AUTO_FORGE). The bridge service finishes the pipeline
//                server-side (USDST -> GOLDST mint).
//   - forgeBuy   (Scenario 2): direct MetalForge mint. The calling user
//                already holds USDST on STRATO; per iteration POSTs
//                /api/metal-forge/buy (USDST -> GOLDST). No Sepolia, no
//                bridge service.
// ----------------------------------------------------------------------------

/** Pre-provisioned Keycloak credential used to drive a virtual user.
 *  Multiple scenarios may share a pool; OAuthClients are deduped by
 *  (clientId, username). */
export interface LoadTestUser {
  username: string;
  password: string;
}

/**
 * Sepolia (or any EVM L1/L2) broadcaster config. One funded EOA signs
 * sequential nonces (`startNonce + i`) for the i-th iteration.
 *
 * On first run init() submits a one-time `approve(MAX)` from the EOA so
 * Permit2 can spend the configured ERC20. After that every iteration just
 * signs a Permit2 typed-data and calls DepositRouter.deposit(...).
 */
export interface TokenSaleBridgeConfig {
  /** Sepolia (or any external EVM testnet) JSON-RPC URL. */
  sepoliaRpcUrl: string;
  /** Funded EOA private key (0x-prefixed). Needs N × amountPerTx of the ERC20
   *  plus enough native gas (Sepolia ETH) for N deposits + the one-time
   *  Permit2 approve. */
  sepoliaPrivateKey: string;
  /** DepositRouter contract on the external chain (0x-prefixed). */
  depositRouterAddress: string;
  /** Recipient STRATO address (hex, with or without 0x). */
  stratoRecipientAddress: string;
  /** Intermediate STRATO landing token (hex, with or without 0x). For the
   *  USDC → GOLDST AUTO_FORGE flow this is USDST. */
  targetStratoToken: string;
  /** ERC20 token contract on the external chain (e.g. Sepolia USDC at
   *  `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`). Required. */
  sepoliaTokenAddress: string;
  /** Permit2 contract address. Default canonical
   *  `0x000000000022D473030F116dDEE9F6B43aC78BA3` (works on every EVM chain
   *  where Uniswap deployed Permit2). Override only for non-standard
   *  deployments. */
  permit2Address?: string;
  /** Permit2 signature deadline window in seconds. Default 1800 (30 min). */
  permitDeadlineSec?: number;
  /** Amount sent per bridge in the token's smallest unit (e.g. `1000` = 0.001
   *  USDC since USDC has 6 decimals). Default `"1000"`. */
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
 * Granularity for STRATO-side balance logging during a tokenSale run.
 *  - "none"    – never read balances (max throughput)
 *  - "summary" – read once before and once after the run, log the deltas
 *
 * Useful to verify that AUTO_FORGE actually landed metal on the recipient
 * (USDST in / GOLDST minted on STRATO). The bridge service is asynchronous
 * so the post-run snapshot may need to be taken some seconds after the run
 * completes — `summary` mode reads it immediately, accept that the totals
 * may continue moving as the bridge service drains its queue.
 */
export type BalanceLoggingMode = "none" | "summary";

// ----------------------------------------------------------------------------
// Token Sale (canonical bridge-in flow) — Scenario 1
// ----------------------------------------------------------------------------

export interface TokenSaleScenarioConfig {
  enabled: boolean;
  /** Backend URL (e.g. https://app.testnet.strato.nexus). Defaults to node[0].url. */
  backendUrl?: string;
  /** Total number of bridge-in + AUTO_FORGE iterations to execute. */
  totalTxCount: number;
  /** Target time window in milliseconds (1000 sales / 30s = 30000). */
  timeWindowMs: number;
  /** Number of concurrent virtual users submitting sales. */
  concurrentUsers: number;
  /** Network identifier label, e.g. "helium". Used only for report metadata. */
  networkLabel?: string;
  /** STRATO chain ID (e.g. 114784819836269 for helium testnet). Used for metadata. */
  chainId?: string | number;

  /** External chain ID string the deposit originates on (e.g. "11155111" Sepolia,
   *  "1" Ethereum mainnet, "8453" Base). Default "11155111". */
  externalChainId?: string;
  /** Sepolia broadcaster (Permit2 + DepositRouter.deposit). Required. */
  bridge: TokenSaleBridgeConfig;
  /** Metal token address on STRATO (hex, with or without 0x). E.g. GOLDST.
   *  Required — used as `targetToken` of the AUTO_FORGE bridge request. */
  metalTokenAddress: string;
  /** Pay token address on STRATO (hex, with or without 0x). E.g. USDST. The
   *  intermediate token AUTO_FORGE consumes when minting metal. Defaults to
   *  helium USDST. Used only for the post-run balance snapshot. */
  payTokenAddress?: string;
  /** MetalForge contract address on STRATO (hex, with or without 0x). Used to
   *  read counterparty balances via Cirrus when `logBalances` != "none".
   *  Defaults to the helium testnet MetalForge. */
  metalForgeAddress?: string;

  /* ---- Behaviour toggles ---- */
  /** If true, do the Fund-page warm-up GETs once per user before hitting the POSTs. */
  includePageLoad?: boolean;

  /**
   * Max retries for transient HTTP errors (429 + any 5xx) on the
   * /api/bridge/requestDepositAction call. Default 3. Backoff between
   * attempts is exponential with jitter: 1500*2^k + random(0..500) ms.
   */
  requestRetries?: number;

  /** Granularity of STRATO-side token-balance snapshotting around the run.
   *  Default "summary". See BalanceLoggingMode for semantics. */
  logBalances?: BalanceLoggingMode;

  /**
   * After all bridge requests have been posted, the bridge service still
   * needs to (a) see each Sepolia deposit confirm, (b) call
   * MercataBridge.completeDeposit on STRATO to mint USDST to the recipient,
   * and (c) execute the queued AUTO_FORGE action via MetalForge.mintMetal
   * to mint GOLDST. This entire pipeline is asynchronous and takes minutes.
   *
   * The scenario polls the recipient's STRATO GOLDST balance via Cirrus
   * (keyed by `bridge.stratoRecipientAddress`, NOT auth-filtered to the
   * calling user) at `autoForgeWaitPollIntervalSec` intervals until either:
   *   - The number of observed GOLDST balance increments equals the number
   *     of successful Sepolia broadcasts (each AUTO_FORGE produces one mint);
   *   - The balance has been stable for ≥ 2 polls AND at least one mint
   *     was observed (treated as [OK] — mints may have coalesced into one
   *     Cirrus update); or
   *   - `autoForgeWaitTimeoutSec` elapses (tagged [TIMEOUT] if 0 movement,
   *     [PARTIAL] if some movement seen but not settled).
   *
   * Default 300 (5 min). Set to 0 to disable the wait entirely.
   */
  autoForgeWaitTimeoutSec?: number;
  /** Polling interval in seconds while waiting for AUTO_FORGE mints to land.
   *  Default 5. */
  autoForgeWaitPollIntervalSec?: number;

  /* ---- Auth ---- */
  /** Optional list of pre-provisioned user credentials. Falls back to node[0] auth. */
  users?: LoadTestUser[];
  /** Optional OpenID discovery URL for user auth (falls back to node[0].auth). */
  openIdDiscoveryUrl?: string;
  /** Optional OAuth client id / secret for user auth. */
  clientId?: string;
  clientSecret?: string;
}

// ----------------------------------------------------------------------------
// Forge Buy (direct metal-forge POST) — Scenario 2
// ----------------------------------------------------------------------------
// The calling Keycloak user already holds USDST on STRATO. Per iteration the
// scenario POSTs /api/metal-forge/buy { metalToken, payToken, payAmount,
// minMetalOut } which executes MetalForge.mintMetal in a single on-STRATO
// tx (USDST -> GOLDST). No Sepolia, no bridge service, no asynchronous wait.
//
// Useful for stressing the metal-forge backend route + on-STRATO MetalForge
// contract in isolation, or when the funded Sepolia EOA has no USDC.
// ----------------------------------------------------------------------------

export interface ForgeBuyScenarioConfig {
  enabled: boolean;
  /** Backend URL (e.g. https://app.testnet.strato.nexus). Defaults to node[0].url. */
  backendUrl?: string;
  /** Total number of metal-forge buy iterations to execute. */
  totalTxCount: number;
  /** Target time window in milliseconds. */
  timeWindowMs: number;
  /** Number of concurrent virtual users submitting buys. */
  concurrentUsers: number;
  /** Network identifier label, e.g. "helium". Report metadata only. */
  networkLabel?: string;
  /** STRATO chain ID. Report metadata only. */
  chainId?: string | number;

  /** Metal token address on STRATO (hex, with or without 0x). E.g. GOLDST.
   *  Required — `metalToken` field of the POST body. */
  metalTokenAddress: string;
  /** Pay token address on STRATO. E.g. USDST. Required — `payToken` field
   *  of the POST body. Defaults to helium USDST. */
  payTokenAddress?: string;
  /** Pay amount per iteration in 18-decimal wei. Required — `payAmount`
   *  field of the POST body. Default `"1000000000000000"` = 0.001 USDST. */
  payAmount?: string;
  /** Slippage guard. `minMetalOut` field of the POST body. Default `"0"`
   *  (accept any output). In production set this from an oracle reading. */
  minMetalOut?: string;
  /** MetalForge contract address on STRATO. Used to read counterparty
   *  balances via Cirrus when `logBalances` != "none". Defaults to the
   *  helium testnet MetalForge. */
  metalForgeAddress?: string;

  /* ---- Behaviour toggles ---- */
  /** If true, do a small page-load warm-up (GETs that the forge Buy page
   *  fires on mount) once per user before hitting the POSTs. Default false.
   *  For an isolated page-load benchmark prefer the `pageLoad` scenario. */
  includePageLoad?: boolean;
  /** Max retries on HTTP 429 + 5xx for /api/metal-forge/buy. Default 3. */
  requestRetries?: number;
  /** STRATO-side balance snapshotting around the run. Default "summary". */
  logBalances?: BalanceLoggingMode;

  /* ---- Auth ---- */
  /** Optional list of pre-provisioned user credentials. Falls back to node[0] auth.
   *  Each user must hold sufficient USDST on STRATO (≥ totalTxCount × payAmount
   *  ÷ concurrentUsers, plus voucher gas headroom for the on-STRATO tx). */
  users?: LoadTestUser[];
  openIdDiscoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

// ----------------------------------------------------------------------------
// Page Load (Scenario 3): warmup-only.
// ----------------------------------------------------------------------------
// Runs a configurable list of authenticated GETs once per virtual user, in
// parallel across users. No POSTs, no balance snapshots, no chain activity.
// Used to isolate page-load behaviour (Keycloak grants + backend GETs +
// Cloudflare path) from the transaction phase of forgeBuy/tokenSale.
// ----------------------------------------------------------------------------

export interface PageLoadStep {
  name: string;
  path: string;
}

export interface PageLoadScenarioConfig {
  enabled: boolean;
  /** Backend URL (e.g. https://app.testnet.strato.nexus). Defaults to node[0].url. */
  backendUrl?: string;
  /** Number of concurrent virtual users issuing the page-load GETs. */
  concurrentUsers: number;
  /** Network identifier label, e.g. "helium". Report metadata only. */
  networkLabel?: string;
  /** Ordered list of GETs each virtual user issues. Default mirrors the
   *  forgeBuy page-load steps (/api/metal-forge/configs + /api/tokens/balance). */
  steps?: PageLoadStep[];

  /* ---- Auth ---- */
  users?: LoadTestUser[];
  openIdDiscoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ScenariosConfig {
  contractDeploy: ContractDeployScenarioConfig;
  functionCall: FunctionCallScenarioConfig;
  mixedWorkload: MixedWorkloadScenarioConfig;
  multiNode: MultiNodeConfig;
  tokenSale: TokenSaleScenarioConfig;
  forgeBuy: ForgeBuyScenarioConfig;
  pageLoad: PageLoadScenarioConfig;
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
