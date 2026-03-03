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

export interface ContractDeployScenarioConfig {
  enabled: boolean;
  batchSize: number;
  batchCount: number;
  batchDelay: number;
  contractSource: string;
  contractName: string;
  contractArgs: Record<string, any>;
}

export interface FunctionCallScenarioConfig {
  enabled: boolean;
  batchSize: number;
  batchCount: number;
  batchDelay: number;
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
}

export interface MultiNodeConfig {
  enabled: boolean;
}

export interface ScenariosConfig {
  contractDeploy: ContractDeployScenarioConfig;
  functionCall: FunctionCallScenarioConfig;
  mixedWorkload: MixedWorkloadScenarioConfig;
  multiNode: MultiNodeConfig;
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
