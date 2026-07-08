import {
  NormalizedWithdrawalAudit,
  WithdrawalAuditListResponse,
  WithdrawalAuditRouteType,
  WithdrawalAuditStatusGroup,
  WithdrawalAuditStepResult,
  WithdrawalAuditTrace,
  WithdrawalAuditTraceNode,
} from "@mercata/shared-types";

export type BridgeWithdrawalStatus = "0" | "1" | "2" | "3" | "4" | string;

export type TraceEdgeType =
  | "bridge_deposit"
  | "transfer"
  | "swap"
  | "cdp_mint"
  | "metal_mint"
  | "psm"
  | "vault"
  | "rewards"
  | "unsupported";

export type TrustAnchorType =
  | "MercataBridge.DepositCompleted"
  | "StratoNativeBridge.NativeDepositCompleted";

export interface WasConfig {
  nodeUrl: string;
  mercataBridge: string;
  stratoNativeBridge: string;
  port: number;
  pollIntervalMs: number;
  traceMaxDepth?: number;
  includeTerminalWithdrawals: boolean;
  oauth?: {
    discoveryUrl?: string;
    clientId?: string;
    clientSecret?: string;
  };
}

export interface HealthResponse {
  status: "ok";
  service: "withdrawal-auditing-service";
}

export interface WarmAuditCacheRequest {
  limit?: number;
  maxDepth?: number;
  statusGroups?: WithdrawalAuditStatusGroup[];
}

export interface WarmAuditCacheResult {
  started: boolean;
  completed: boolean;
  groups: Record<WithdrawalAuditStatusGroup, number>;
  skippedReason?: string;
}

export interface AuditCacheKeyParts {
  routeType: WithdrawalAuditRouteType;
  withdrawalId: string;
  bridgeStatus: BridgeWithdrawalStatus;
  timestamp: string;
  maxDepth?: number;
}

export interface CachedWithdrawalAudit {
  key: string;
  keyParts: AuditCacheKeyParts;
  trace: WithdrawalAuditTrace;
}

export interface WithdrawalAuditCache {
  get(key: string): CachedWithdrawalAudit | undefined;
  getLatest(
    routeType: WithdrawalAuditRouteType,
    withdrawalId: string,
    maxDepth?: number,
  ): CachedWithdrawalAudit | undefined;
  set(keyParts: AuditCacheKeyParts, trace: WithdrawalAuditTrace): void;
  listRecent(
    statusGroup: WithdrawalAuditStatusGroup,
    limit: number,
    maxDepth?: number,
  ): CachedWithdrawalAudit[];
  size(): number;
}

export interface CirrusQueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface CirrusClient {
  getRows<T>(table: string, params?: CirrusQueryParams): Promise<T[]>;
  verifyConnectivity(): Promise<void>;
}

export interface CirrusMappingRow<TValue> {
  key: string;
  value: TValue;
  block_timestamp?: string;
}

export interface CirrusEventRow {
  event_name: string;
  address: string;
  attributes: Record<string, string | number | boolean | undefined>;
  block_timestamp?: string;
  block_number?: string | number;
  transaction_hash?: string;
  transaction_sender?: string;
}

export interface TraceLot {
  owner: string;
  token: string;
  amount: string;
  transactionHash?: string;
  blockNumber?: string | number;
  source: TraceEdgeType | "unknown";
  event?: CirrusEventRow;
}

export interface TraceCursor {
  owner: string;
  token: string;
  amount: string;
  depth: number;
  beforeEvent?: CirrusEventRow;
  sourceLot?: TraceLot;
}

export interface TraceEdge {
  type: TraceEdgeType;
  from?: TraceLot;
  to: TraceLot;
  event?: CirrusEventRow;
  result: WithdrawalAuditStepResult;
  explanation: string;
}

export interface TrustAnchor {
  type: TrustAnchorType;
  owner: string;
  token: string;
  amount: string;
  event: CirrusEventRow;
}

export interface TraceCoverage {
  clean: string;
  tainted: string;
  unknown: string;
}

export interface TraceContext {
  withdrawal: NormalizedWithdrawalAudit;
  maxDepth?: number;
}

export interface ProvenanceTraceResult {
  coverage: TraceCoverage;
  traceTree: WithdrawalAuditTraceNode;
  summary: string[];
  stoppedEarly: boolean;
}

export interface WithdrawalCandidateRepository {
  fetchWithdrawalCandidates(
    statusGroup: WithdrawalAuditStatusGroup,
    limit: number,
  ): Promise<NormalizedWithdrawalAudit[]>;
  fetchCanonicalWithdrawalEvent(
    withdrawal: NormalizedWithdrawalAudit,
  ): Promise<CirrusEventRow | null>;
  fetchFundingLots(cursor: TraceCursor): Promise<TraceLot[]>;
  fetchTrustAnchor(edge: TraceEdge): Promise<TrustAnchor | null>;
}

export interface ProvenanceEngine {
  traceWithdrawal(context: TraceContext): Promise<WithdrawalAuditTrace>;
  classifyCoverage(lots: TraceLot[], requestedAmount: string): TraceCoverage;
  resolveTraceEdge(lot: TraceLot): Promise<TraceEdge>;
}

export interface WithdrawalAuditService {
  getRecentAudits(
    limit: number,
    maxDepth: number | undefined,
    statusGroup: WithdrawalAuditStatusGroup,
  ): Promise<WithdrawalAuditListResponse>;
  getAudit(
    routeType: WithdrawalAuditRouteType,
    withdrawalId: string,
    maxDepth?: number,
  ): Promise<WithdrawalAuditTrace | null>;
  warmAuditCache(request?: WarmAuditCacheRequest): Promise<WarmAuditCacheResult>;
}
