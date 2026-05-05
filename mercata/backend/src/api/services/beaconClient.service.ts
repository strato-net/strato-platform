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

  /** GET helper with primary→fallback failover. Beacon endpoints
   *  occasionally rate-limit; we don't retry on 4xx (bad request),
   *  only on 5xx and network-level failures. */
  private async fetch<T>(path: string): Promise<T> {
    try {
      return (await this.primary.get<T>(path)).data;
    } catch (err: any) {
      const status = err?.response?.status;
      const isClientError = status >= 400 && status < 500;
      if (isClientError || !this.fallback) throw err;
      try {
        return (await this.fallback.get<T>(path)).data;
      } catch {
        throw err; // surface the original (primary) error
      }
    }
  }
}
