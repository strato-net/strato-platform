/**
 * Client for `proverd`, the service that produces sync-committee
 * subset-aggregate proofs (app/circuits/cmd/proverd).
 *
 * The prover is not trusted and holds no keys. Its aggregate is public input
 * to the proof, and EthLightClient still puts that aggregate through the BLS
 * pairing against the real sync-committee signature — a prover that lies
 * produces something the chain rejects. So a bad or hostile prover is a
 * liveness problem, never a safety one, and every failure here degrades to
 * the native aggregation path rather than blocking a claim.
 */

import axios from "axios";

const PROVER_URL_ENV = "BRIDGE_PROVER_URL";

/** Proving is tens of seconds; the timeout only needs to catch a hang. */
const PROVE_TIMEOUT_MS = Number(process.env.BRIDGE_PROVER_TIMEOUT_MS || 300_000);

/** Committee digests are a hash, not a proof — they should be immediate. */
const QUICK_TIMEOUT_MS = 15_000;

export interface AggregateProof {
  /** 128-byte EIP-2537 uncompressed G1, the form submitAggregateProof takes. */
  aggregate: string;
  /** The committee digest the proof was made against. */
  commitment: string;
  /** PlonkVerifier's word layout. */
  proof: string[];
  publicInputs: string[];
  signers: number;
  elapsedMs: number;
}

function baseUrl(): string | undefined {
  const raw = process.env[PROVER_URL_ENV];
  if (!raw) return undefined;
  return raw.replace(/\/$/, "");
}

/** Whether a prover is configured at all. Unset means the proof path is off
 *  and anchoring falls back to deriving the aggregate on-chain. */
export function proverConfigured(): boolean {
  return baseUrl() !== undefined;
}

async function post<T>(path: string, body: unknown, timeout: number): Promise<T> {
  const url = baseUrl();
  if (!url) throw new Error(`bridgeProver: ${PROVER_URL_ENV} is not set`);
  const { data } = await axios.post<T>(`${url}${path}`, body, {
    timeout,
    headers: { "content-type": "application/json" },
    // A proof is ~30 KB and the committee going out is ~50 KB.
    maxBodyLength: 8 * 1024 * 1024,
    maxContentLength: 8 * 1024 * 1024,
  });
  return data;
}

/**
 * Prove that the aggregate of the members `participationBits` selects, out of
 * `pubkeys`, is the returned aggregate.
 *
 * @param pubkeys 512 compressed committee keys, in committee order.
 * @param participationBits 64-byte SSZ bitvector, 0x-prefixed.
 */
export async function proveAggregate(
  pubkeys: string[],
  participationBits: string,
): Promise<AggregateProof> {
  if (pubkeys.length !== 512) {
    throw new Error(`bridgeProver: expected 512 pubkeys, got ${pubkeys.length}`);
  }
  const res = await post<AggregateProof>(
    "/prove",
    { pubkeys, participationBits },
    PROVE_TIMEOUT_MS,
  );
  if (!res?.aggregate || !Array.isArray(res.proof) || res.proof.length === 0) {
    throw new Error("bridgeProver: /prove returned no proof");
  }
  return res;
}

/**
 * The committee digest EthLightClient stores, without proving anything.
 * Deployment needs this before any proof exists, to call
 * setCommitteeCommitment for a bootstrapped period.
 */
export async function committeeCommitment(pubkeys: string[]): Promise<string> {
  const res = await post<{ commitment: string }>(
    "/commitment",
    { pubkeys },
    QUICK_TIMEOUT_MS,
  );
  if (!res?.commitment) throw new Error("bridgeProver: /commitment returned nothing");
  return res.commitment;
}

/** The verifying key words for PlonkVerifier.initialize, for deployment. */
export async function verifyingKey(): Promise<{ words: string[]; verifierId: string }> {
  const url = baseUrl();
  if (!url) throw new Error(`bridgeProver: ${PROVER_URL_ENV} is not set`);
  const { data } = await axios.get(`${url}/vk`, { timeout: QUICK_TIMEOUT_MS });
  return data;
}

/** Whether the prover has its setup loaded. Cold setup is minutes with a real
 *  ceremony SRS, so a caller may want to know before committing to a flow. */
export async function proverReady(): Promise<boolean> {
  const url = baseUrl();
  if (!url) return false;
  try {
    const { data } = await axios.get(`${url}/health`, { timeout: QUICK_TIMEOUT_MS });
    return Boolean(data?.ready);
  } catch {
    return false;
  }
}
