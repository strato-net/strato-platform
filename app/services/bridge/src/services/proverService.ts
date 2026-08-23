/**
 * Client for `proverd`, which produces sync-committee subset-aggregate proofs
 * (app/circuits/cmd/proverd). Expected to run on this same host.
 *
 * The prover is not trusted and holds no keys. Its aggregate is public input
 * to the proof, and EthLightClient still puts that aggregate through the BLS
 * pairing against the real sync-committee signature -- a prover that lies
 * produces something the chain rejects. A bad or absent prover is therefore a
 * liveness problem, never a safety one, and every failure here leaves the
 * anchor to be derived on-chain instead.
 */

import axios from "axios";
import { logInfo, logError } from "../utils/logger";

/** Proving is tens of seconds; the timeout only needs to catch a hang. */
const PROVE_TIMEOUT_MS = Number(process.env.PROVER_TIMEOUT_MS || 300_000);
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

const baseUrl = (): string | undefined => {
  const raw = process.env.PROVER_URL;
  return raw ? raw.replace(/\/$/, "") : undefined;
};

/** Unset means the proof path is off and anchors aggregate on-chain. */
export const proverConfigured = (): boolean => baseUrl() !== undefined;

/** Whether the prover has its setup loaded. Cold setup is minutes with a real
 *  ceremony SRS, so it is worth knowing before queuing work behind it. */
export const proverReady = async (): Promise<boolean> => {
  const url = baseUrl();
  if (!url) return false;
  try {
    const { data } = await axios.get(`${url}/health`, { timeout: QUICK_TIMEOUT_MS });
    return Boolean(data?.ready);
  } catch {
    return false;
  }
};

/**
 * Prove that the aggregate of the members `participationBits` selects, out of
 * `pubkeys`, is the returned aggregate.
 *
 * @param pubkeys 512 compressed committee keys, in committee order.
 * @param participationBits 64-byte SSZ bitvector, 0x-prefixed.
 */
export const proveAggregate = async (
  pubkeys: string[],
  participationBits: string,
): Promise<AggregateProof> => {
  const url = baseUrl();
  if (!url) throw new Error("proverService: PROVER_URL is not set");
  if (pubkeys.length !== 512) {
    throw new Error(`proverService: expected 512 pubkeys, got ${pubkeys.length}`);
  }
  const started = Date.now();
  const { data } = await axios.post<AggregateProof>(
    `${url}/prove`,
    { pubkeys, participationBits },
    {
      timeout: PROVE_TIMEOUT_MS,
      headers: { "content-type": "application/json" },
      // The committee going out is ~50 KB; the proof coming back ~30 KB.
      maxBodyLength: 8 * 1024 * 1024,
      maxContentLength: 8 * 1024 * 1024,
    },
  );
  if (!data?.aggregate || !Array.isArray(data.proof) || data.proof.length === 0) {
    throw new Error("proverService: /prove returned no proof");
  }
  logInfo("ProverService", `proved ${data.signers} signers in ${Date.now() - started}ms`);
  return data;
};

/** The committee digest EthLightClient stores, without proving anything. */
export const committeeCommitment = async (pubkeys: string[]): Promise<string> => {
  const url = baseUrl();
  if (!url) throw new Error("proverService: PROVER_URL is not set");
  const { data } = await axios.post<{ commitment: string }>(
    `${url}/commitment`,
    { pubkeys },
    { timeout: QUICK_TIMEOUT_MS, maxBodyLength: 8 * 1024 * 1024 },
  );
  if (!data?.commitment) throw new Error("proverService: /commitment returned nothing");
  return data.commitment;
};

export default { proverConfigured, proverReady, proveAggregate, committeeCommitment };
