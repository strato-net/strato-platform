// STRATO BLOC transaction path: the native named-contract/function/transfer flow.
// Ported from smd-ui/src/lib/walletTx.ts. Unlike the EVM path, the node builds
// the unsigned transaction and we sign an EIP-712 typed-data hash of it.
//
//   1. POST {bloc}/transaction/unsigned   -> unsigned tx(s)
//   2. sign EIP-712 hash with the keyring  (domain {name:"STRATO",version:"1"})
//   3. POST {stratoApi}/transaction        -> submit signed RawTransaction'
//   4. POST {bloc}/transactions/results    -> poll until resolved

import { type Address, type Hex, hashTypedData } from "viem";
import { keyring } from "./keyring";
import type { StratoNetwork } from "./networks";
import { addTx } from "./history";

const SIGNING_NETWORK = "STRATO";

export type StratoTxType = "CONTRACT" | "FUNCTION" | "TRANSFER";

export interface BlocTxParams {
  type: StratoTxType;
  payload: Record<string, unknown>;
  /** wraps the tx as a call on the user's User-wallet contract */
  username?: string;
}

/** A single named contract-function call (FUNCTION tx). */
export interface BlocCall {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, unknown>;
}

export interface TxParams {
  gasLimit?: number;
  gasPrice?: number;
}

interface UnsignedTx {
  hash?: string;
  data: {
    nonce: number | string;
    gasLimit: number | string;
    to: string;
    functionName?: string;
    args?: string[];
    network?: string;
  };
}

// EIP-712 type definition matching the STRATO node.
const STRATO_TYPED_DATA = {
  domain: { name: "STRATO", version: "1" } as const,
  types: {
    Transaction: [
      { name: "to", type: "address" },
      { name: "funcName", type: "string" },
      { name: "args", type: "string[]" },
      { name: "nonce", type: "uint256" },
      { name: "gasLimit", type: "uint256" },
      { name: "network", type: "string" },
    ],
  } as const,
  primaryType: "Transaction" as const,
};

function chainQuery(network: StratoNetwork): string {
  return network.chainId ? `?chainid=${network.chainId}` : "";
}

async function fetchUnsignedTxs(
  network: StratoNetwork,
  from: Address,
  txs: { type: StratoTxType; payload: Record<string, unknown> }[],
  opts: { username?: string; txParams?: TxParams } = {}
): Promise<UnsignedTx[]> {
  if (!network.blocUrl) throw new Error("Network has no BLOC URL configured");
  const params = new URLSearchParams();
  if (network.chainId) params.set("chainid", String(network.chainId));
  if (opts.username) params.set("username", opts.username);
  const qs = params.toString();
  const res = await fetch(
    `${network.blocUrl}/transaction/unsigned${qs ? `?${qs}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txs,
        address: from.replace(/^0x/, ""),
        ...(opts.txParams ? { txParams: opts.txParams } : {}),
      }),
    }
  );
  if (!res.ok) throw new Error(`unsigned tx request failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?._unsignedTxs)) return data._unsignedTxs;
  if (Array.isArray(data?.txs)) return data.txs;
  return [];
}

/** Sign + submit each unsigned tx, then poll all to resolution. */
async function signSubmitResolve(
  network: StratoNetwork,
  from: Address,
  unsigned: UnsignedTx[]
): Promise<any[]> {
  // The node assigns the SAME base nonce to every tx in a bundle, so a multi-tx
  // bundle (e.g. approve + swap) must be given sequential nonces before signing,
  // or later txs are rejected for a stale nonce. Single-tx is unaffected (i=0).
  const base = BigInt(unsigned[0]?.data?.nonce ?? 0);
  const hashes: string[] = [];
  for (let i = 0; i < unsigned.length; i++) {
    const tx = unsigned[i];
    tx.data.nonce = (base + BigInt(i)).toString();
    const sig = await signOne(from, tx);
    const hash = await submitSigned(network, tx, sig);
    if (hash) hashes.push(hash);
  }
  return pollResults(network, hashes);
}

async function signOne(from: Address, tx: UnsignedTx) {
  const d = tx.data;
  const hash = hashTypedData({
    ...STRATO_TYPED_DATA,
    message: {
      to: `0x${d.to.replace(/^0x/, "")}` as Hex,
      funcName: d.functionName ?? "",
      args: d.args ?? [],
      nonce: BigInt(d.nonce),
      gasLimit: BigInt(d.gasLimit),
      network: SIGNING_NETWORK,
    },
  });
  const sig = await keyring.signHash(from, hash);
  // STRATO expects r/s as 64 hex chars (no 0x) and v as the 1-byte recovery+27.
  return {
    r: sig.r.replace(/^0x/, "").padStart(64, "0"),
    s: sig.s.replace(/^0x/, "").padStart(64, "0"),
    v: (sig.recovery + 27).toString(16).padStart(2, "0"),
  };
}

async function submitSigned(
  network: StratoNetwork,
  tx: UnsignedTx,
  sig: { r: string; s: string; v: string }
): Promise<string> {
  if (!network.stratoApiUrl) throw new Error("Network has no strato-api URL");
  const signedTx = {
    nonce: Number(tx.data.nonce),
    gasLimit: tx.data.gasLimit,
    to: tx.data.to,
    funcName: tx.data.functionName,
    args: tx.data.args,
    network: SIGNING_NETWORK,
    r: sig.r,
    s: sig.s,
    v: sig.v,
    txVersion: 1,
  };
  const res = await fetch(
    `${network.stratoApiUrl}/transaction${chainQuery(network)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedTx),
    }
  );
  if (!res.ok) throw new Error(`submit failed: ${res.status}`);
  const data = await res.json();
  return typeof data === "string" ? data : data?.hash ?? tx.hash ?? "";
}

async function pollResults(
  network: StratoNetwork,
  hashes: string[],
  timeout = 60_000,
  interval = 3_000
): Promise<any[]> {
  if (!network.blocUrl) return [];
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${network.blocUrl}/transactions/results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(hashes),
    });
    const results = res.ok ? await res.json() : [];
    const list = Array.isArray(results) ? results : [];
    if (list.length && list.every((r: any) => r?.status !== "Pending")) return list;
    if (Date.now() - start >= timeout) return list;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Build, sign, submit, and confirm a STRATO BLOC transaction. */
export async function sendBlocTransaction(
  network: StratoNetwork,
  from: Address,
  params: BlocTxParams
): Promise<any> {
  const unsigned = await fetchUnsignedTxs(
    network,
    from,
    [{ type: params.type, payload: params.payload }],
    { username: params.username }
  );
  if (unsigned.length === 0) throw new Error("Node returned no unsigned transaction");

  const results = await signSubmitResolve(network, from, unsigned);
  const failed = results.find((r: any) => r?.status === "Failure");

  const p = params.payload as Record<string, unknown>;
  const fn = (p.functionName || p.methodName || p.method) as string | undefined;
  const cName = (p.contractName || p.cName) as string | undefined;
  const title =
    params.type === "TRANSFER"
      ? "STRATO transfer"
      : fn
        ? `${fn}()`
        : cName
          ? `Deploy ${cName}`
          : "STRATO transaction";
  await addTx({
    hash: results[0]?.hash ?? "",
    from,
    chainId: network.chainId,
    timestamp: Date.now(),
    status: failed ? "failed" : "confirmed",
    kind: "bloc",
    title,
  });

  if (failed) throw new Error(failed.txResult?.message || failed.message || "Transaction failed");
  return results[0] ?? { status: "Success" };
}

/**
 * Submit a bundle of named contract-function calls (e.g. approve + swap) in one
 * BLOC request, signing each. Returns the resolved results.
 */
export async function sendBlocCalls(
  network: StratoNetwork,
  from: Address,
  calls: BlocCall[],
  txParams?: TxParams
): Promise<any[]> {
  const txs = calls.map((c) => ({ type: "FUNCTION" as const, payload: { ...c } }));
  const unsigned = await fetchUnsignedTxs(network, from, txs, { txParams });
  if (unsigned.length === 0) throw new Error("Node returned no unsigned transactions");
  const results = await signSubmitResolve(network, from, unsigned);
  const failed = results.find((r: any) => r?.status === "Failure");
  if (failed) {
    throw new Error(failed.txResult?.message || failed.message || "Transaction failed");
  }
  return results;
}
