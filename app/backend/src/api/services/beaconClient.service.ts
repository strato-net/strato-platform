/**
 * Thin wrapper around the Ethereum Beacon-API endpoints we need for
 * the trustless bridge-in flow. All calls are JSON over HTTPS; we
 * don't bundle a typed BeaconChain client because the surface is
 * small (5–6 endpoints) and the JSON shapes are stable since Altair.
 *
 * Failover: if the configured `upstream` errors or returns non-2xx,
 * we transparently retry against `fallback` (typically a public
 * provider). Both are configured per-chain in {@link rpc.config.ts}.
 */
import axios, { AxiosInstance } from "axios";

import { getBeaconUpstream } from "../../config/rpc.config";

// ─────────────────────────────────────────────────────────────────────
// Beacon-API JSON shapes
//
// We type only the fields we touch. The actual JSON has more — that's
// intentional, we pass-through extra fields via `unknown` when we
// don't need them.
// ─────────────────────────────────────────────────────────────────────

export interface BeaconBlockHeader {
  slot: string;            // uint64 as decimal string
  proposer_index: string;
  parent_root: string;     // 0x-prefixed hex
  state_root: string;
  body_root: string;
}

export interface ExecutionPayloadHeader {
  parent_hash: string;
  fee_recipient: string;
  state_root: string;
  receipts_root: string;
  logs_bloom: string;       // 256 bytes hex
  prev_randao: string;
  block_number: string;
  gas_limit: string;
  gas_used: string;
  timestamp: string;
  extra_data: string;       // variable hex
  base_fee_per_gas: string;
  block_hash: string;
  transactions_root: string;
  withdrawals_root: string;
  blob_gas_used?: string;   // Deneb+
  excess_blob_gas?: string; // Deneb+
}

export interface SyncCommittee {
  pubkeys: string[];        // 512 × 0x-prefixed hex (48 bytes each, compressed G1)
  aggregate_pubkey: string; // 48 bytes compressed G1
}

export interface SyncAggregate {
  sync_committee_bits: string;      // 64-byte SSZ Bitvector[512]
  sync_committee_signature: string; // 96 bytes compressed G2
}

export interface LightClientHeader {
  beacon: BeaconBlockHeader;
  execution?: ExecutionPayloadHeader;   // present in Capella+
  execution_branch?: string[];          // present in Capella+ (depth 4)
}

export interface LightClientFinalityUpdate {
  attested_header: LightClientHeader;
  finalized_header: LightClientHeader;
  finality_branch: string[];           // depth 6 pre-Electra; 7 in Electra+
  sync_aggregate: SyncAggregate;
  signature_slot: string;
}

export interface LightClientUpdate extends LightClientFinalityUpdate {
  next_sync_committee: SyncCommittee;
  next_sync_committee_branch: string[];
}

export interface LightClientBootstrap {
  header: LightClientHeader;
  current_sync_committee: SyncCommittee;
  current_sync_committee_branch: string[];
}

/** Raw beacon block (we extract the body to compute execution_branch
 *  for parent-chain-anchor flows — body fields are fork-specific so
 *  we keep this typed as `unknown` and parse contextually). */
export interface BeaconBlockResponse {
  data: { message: { slot: string; body: Record<string, unknown> } };
  version: string;
}

// ─────────────────────────────────────────────────────────────────────
// Per-chain client cache
// ─────────────────────────────────────────────────────────────────────

const _clients = new Map<string, BeaconClient>();

/**
 * Return a BeaconClient for the given source chain (Ethereum mainnet,
 * Sepolia, etc.). Throws if no beacon endpoint is configured for the
 * chain — that's a misconfiguration the caller should surface as
 * "trustless path unavailable; falling back to relayer attestation".
 */
export function beaconClientFor(chainId: string): BeaconClient {
  const cached = _clients.get(chainId);
  if (cached) return cached;
  const { upstream, fallback } = getBeaconUpstream(chainId);
  if (!upstream && !fallback) {
    throw new Error(`beaconClient: no beacon endpoint configured for chainId=${chainId}`);
  }
  const client = new BeaconClient(upstream, fallback);
  _clients.set(chainId, client);
  return client;
}

// ─────────────────────────────────────────────────────────────────────
// BeaconClient
// ─────────────────────────────────────────────────────────────────────

export class BeaconClient {
  private readonly primary: AxiosInstance;
  private readonly fallback?: AxiosInstance;

  constructor(upstream: string | undefined, fallback: string | undefined) {
    if (!upstream) throw new Error("BeaconClient: upstream required");
    this.primary = axios.create({
      baseURL: upstream.replace(/\/$/, ""),
      headers: { Accept: "application/json" },
      timeout: 30_000,
    });
    if (fallback && fallback !== upstream) {
      this.fallback = axios.create({
        baseURL: fallback.replace(/\/$/, ""),
        headers: { Accept: "application/json" },
        timeout: 30_000,
      });
    }
  }

  // ───────── Light-client endpoints ─────────

  /** Latest LightClientFinalityUpdate. The "live" update advances
   *  every epoch (~6.4 minutes) as new finalized headers come in. */
  async getFinalityUpdate(): Promise<LightClientFinalityUpdate> {
    const r = await this.fetch<{ data: LightClientFinalityUpdate }>(
      "/eth/v1/beacon/light_client/finality_update"
    );
    return r.data;
  }

  /** Light-client updates for a contiguous range of sync-committee
   *  periods. Used to discover next_sync_committee for advanceCommittee. */
  async getLightClientUpdates(startPeriod: number, count: number): Promise<LightClientUpdate[]> {
    const r = await this.fetch<Array<{ data: LightClientUpdate }>>(
      `/eth/v1/beacon/light_client/updates?start_period=${startPeriod}&count=${count}`
    );
    return r.map((x) => x.data);
  }

  /** Bootstrap data for a known-finalized block root. One-time at
   *  initial deploy: gives us the trusted starting committee. */
  async getBootstrap(blockRoot: string): Promise<LightClientBootstrap> {
    const r = await this.fetch<{ data: LightClientBootstrap }>(
      `/eth/v1/beacon/light_client/bootstrap/${blockRoot}`
    );
    return r.data;
  }

  // ───────── Header / block lookup ─────────

  /** Canonical header at slot or block-root or "head"/"finalized". */
  async getHeader(blockId: string): Promise<{ root: string; header: { message: BeaconBlockHeader; signature: string } }> {
    const r = await this.fetch<{ data: { root: string; header: { message: BeaconBlockHeader; signature: string } } }>(
      `/eth/v1/beacon/headers/${blockId}`
    );
    return r.data;
  }

  /** Full beacon block at a specific slot — needed when the trustless
   *  path has to anchor a non-finalized block via parent-chain
   *  extension (we extract the EPH and execution_branch from the
   *  body). Slot id can be "head", "finalized", or a numeric slot. */
  async getBlock(blockId: string): Promise<BeaconBlockResponse> {
    const r = await this.fetch<BeaconBlockResponse>(`/eth/v2/beacon/blocks/${blockId}`);
    return r;
  }

  /**
   * Full BeaconState at a slot, in SSZ-encoded form. Used by the
   * state-proof anchor path (block_roots / historical_summaries) — we
   * deserialize off-chain to build a Merkle proof against
   * attested.state_root.
   *
   * Returned bytes are the SSZ Container encoding; the caller picks
   * the fork-specific schema (lodestar's `ssz[fork].BeaconState`) to
   * deserialize.
   *
   * Response is sizable (50–80 MB on mainnet, ~10–20 MB on Sepolia)
   * so this trades the parent-walk's O(N) sequential `getHeader`
   * fetches for one big payload — net much faster on rate-limited
   * endpoints, plus it's amenable to gzip on the wire.
   *
   * Endpoint requires the beacon node to expose `/eth/v2/debug/beacon/
   * states/{state_id}`. Lodestar enables this by default; Nimbus needs
   * `--rest-debug-enabled`. If it's gated, callers should fall back to
   * the parent-walk path.
   */
  async getStateSSZ(stateId: string): Promise<Buffer> {
    return fetchSSZWithRetry(this.primary, this.fallback, `/eth/v2/debug/beacon/states/${stateId}`);
  }

  // ───────── One-time setup helpers ─────────

  async getGenesis(): Promise<{ genesis_time: string; genesis_validators_root: string; genesis_fork_version: string }> {
    const r = await this.fetch<{ data: { genesis_time: string; genesis_validators_root: string; genesis_fork_version: string } }>(
      "/eth/v1/beacon/genesis"
    );
    return r.data;
  }

  async getForkSchedule(): Promise<Array<{ previous_version: string; current_version: string; epoch: string }>> {
    const r = await this.fetch<{ data: Array<{ previous_version: string; current_version: string; epoch: string }> }>(
      "/eth/v1/config/fork_schedule"
    );
    return r.data;
  }

  // ───────── Internals ─────────

  /** GET helper with primary→fallback failover plus 429/5xx
   *  exponential-backoff retry. Beacon endpoints (free public ones
   *  especially) routinely rate-limit; without backoff a single 429
   *  cascades into a hard failure of the whole flow. */
  private async fetch<T>(path: string): Promise<T> {
    return fetchWithRetry(this.primary, this.fallback, path);
  }
}

/** Max attempts per beacon GET (across primary+fallback). Tunable via
 *  env so an operator with a paid endpoint can drop it back to 1. */
const BEACON_MAX_ATTEMPTS: number = (() => {
  const raw = process.env.BEACON_MAX_ATTEMPTS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 4;
})();

/** Status codes worth retrying. 429 = rate limit, 502/503/504 =
 *  upstream hiccup. Hard 4xx (400, 401, 404) don't retry — the
 *  request is wrong, not transient. */
function isRetryableStatus(s: number | undefined): boolean {
  if (s === undefined) return true; // network error / timeout
  return s === 429 || (s >= 500 && s <= 599);
}

/** Sleep helper that honours a server-supplied Retry-After (seconds
 *  or HTTP-date), falling back to exponential backoff. */
async function backoffDelay(err: any, attempt: number): Promise<void> {
  const retryAfter = err?.response?.headers?.["retry-after"];
  let ms: number | undefined;
  if (typeof retryAfter === "string") {
    const asInt = parseInt(retryAfter, 10);
    if (Number.isFinite(asInt)) {
      ms = asInt * 1000;
    } else {
      const asDate = Date.parse(retryAfter);
      if (Number.isFinite(asDate)) ms = Math.max(0, asDate - Date.now());
    }
  }
  if (ms === undefined) {
    // 250 → 500 → 1000 → 2000 ms with ±20% jitter.
    const base = Math.min(2000, 250 * 2 ** attempt);
    ms = base * (0.8 + Math.random() * 0.4);
  }
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry<T>(
  primary: AxiosInstance,
  fallback: AxiosInstance | undefined,
  path: string,
): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt < BEACON_MAX_ATTEMPTS; attempt++) {
    const client = attempt === 0 || !fallback ? primary : fallback;
    try {
      return (await client.get<T>(path)).data;
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      if (!isRetryableStatus(status)) throw err;
      if (attempt === BEACON_MAX_ATTEMPTS - 1) break;
      const reason = status ?? "network";
      console.warn(`[Beacon] ${reason} on GET ${path} (attempt ${attempt + 1}/${BEACON_MAX_ATTEMPTS}); backing off`);
      await backoffDelay(err, attempt);
    }
  }
  throw lastErr;
}

/**
 * Same shape as {fetchWithRetry} but for SSZ binary responses. Sets
 * `Accept: application/octet-stream` and an arraybuffer responseType
 * so the body comes back as raw bytes (BeaconState is many MB; JSON
 * would balloon it 3–5×). The 30s default timeout in the client
 * constructor is bumped to 120s here since state fetches are big.
 */
async function fetchSSZWithRetry(
  primary: AxiosInstance,
  fallback: AxiosInstance | undefined,
  path: string,
): Promise<Buffer> {
  let lastErr: any;
  for (let attempt = 0; attempt < BEACON_MAX_ATTEMPTS; attempt++) {
    const client = attempt === 0 || !fallback ? primary : fallback;
    try {
      const res = await client.get(path, {
        headers: { Accept: "application/octet-stream" },
        responseType: "arraybuffer",
        timeout: 120_000,
      });
      return Buffer.from(res.data as ArrayBuffer);
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      if (!isRetryableStatus(status)) throw err;
      if (attempt === BEACON_MAX_ATTEMPTS - 1) break;
      const reason = status ?? "network";
      console.warn(`[Beacon] ${reason} on GET ${path} SSZ (attempt ${attempt + 1}/${BEACON_MAX_ATTEMPTS}); backing off`);
      await backoffDelay(err, attempt);
    }
  }
  throw lastErr;
}
