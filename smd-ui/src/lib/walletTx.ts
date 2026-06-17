import type { WalletClient } from "viem";
import { api } from "@/lib/api";
import { env, runtime } from "@/lib/env";

// External-wallet transaction signing, ported from the Mercata app's flow:
//   1. POST /bloc/v2.2/transaction/unsigned  -> unsigned tx(s) with per-tx data
//   2. walletClient.signTypedData(...)        -> STRATO EIP-712 signature
//   3. POST /strato-api/eth/v1.2/transaction  -> submit signed tx
//   4. POST /bloc/v2.2/transactions/results   -> poll until resolved
// Used when an EXTERNAL wallet is connected (no STRATO vault session). The STRATO
// session path stays on /strato/v2.3/transaction (server-side vault signing).

const SIGNING_NETWORK = "STRATO";

export type StratoTxType = "CONTRACT" | "FUNCTION" | "TRANSFER";

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

const chainParam = () => {
  const id = runtime.chainId();
  return id ? { chainid: id } : {};
};

function parseSignature(sig: string): { r: string; s: string; v: string } {
  const raw = sig.replace(/^0x/, "");
  return { r: raw.slice(0, 64), s: raw.slice(64, 128), v: raw.slice(128, 130) };
}

async function fetchUnsignedTxs(
  type: StratoTxType,
  payload: Record<string, unknown>,
  userAddress: string,
  username?: string
): Promise<UnsignedTx[]> {
  const { data } = await api.post(
    `${env.BLOC_URL}/transaction/unsigned`,
    { txs: [{ payload, type }], address: userAddress.replace(/^0x/, "") },
    // `username` makes the node wrap CONTRACT/FUNCTION txs as a call to the user's
    // User wallet contract, producing a MessageTX an external wallet can sign.
    { params: { ...chainParam(), ...(username ? { username } : {}) } }
  );
  // Tolerate a few shapes: a raw array, or a wrapper with _unsignedTxs / txs.
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?._unsignedTxs)) return data._unsignedTxs;
  if (Array.isArray(data?.txs)) return data.txs;
  return [];
}

async function signOne(walletClient: WalletClient, tx: UnsignedTx): Promise<string> {
  const d = tx.data;
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: { name: "STRATO", version: "1" },
    types: {
      Transaction: [
        { name: "to", type: "address" },
        { name: "funcName", type: "string" },
        { name: "args", type: "string[]" },
        { name: "nonce", type: "uint256" },
        { name: "gasLimit", type: "uint256" },
        { name: "network", type: "string" },
      ],
    },
    primaryType: "Transaction",
    message: {
      to: `0x${d.to.replace(/^0x/, "")}` as `0x${string}`,
      funcName: d.functionName ?? "",
      args: d.args ?? [],
      nonce: BigInt(d.nonce),
      gasLimit: BigInt(d.gasLimit),
      network: SIGNING_NETWORK,
    },
  });
}

async function submitSigned(tx: UnsignedTx, sig: { r: string; s: string; v: string }): Promise<string> {
  const signedTx = {
    nonce: tx.data.nonce,
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
  const { data } = await api.post(`${env.STRATO_URL}/transaction`, signedTx, { params: chainParam() });
  return typeof data === "string" ? data : data?.hash ?? tx.hash ?? "";
}

async function pollResults(hashes: string[], timeout = 60000, interval = 3000): Promise<any[]> {
  const start = Date.now();
  while (true) {
    const { data: results } = await api.post(`${env.BLOC_URL}/transactions/results`, hashes);
    const list = Array.isArray(results) ? results : [];
    if (list.every((r: any) => r?.status !== "Pending")) return list;
    if (Date.now() - start >= timeout) return list;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Build, sign (via the connected external wallet), submit, and confirm a STRATO transaction. */
export async function signAndSubmitViaWallet(
  walletClient: WalletClient,
  userAddress: string,
  type: StratoTxType,
  payload: Record<string, unknown>,
  options?: { username?: string }
): Promise<any> {
  const unsigned = await fetchUnsignedTxs(type, payload, userAddress, options?.username);
  if (unsigned.length === 0) throw new Error("Node returned no unsigned transaction to sign");

  const hashes: string[] = [];
  for (const tx of unsigned) {
    const signature = await signOne(walletClient, tx);
    const hash = await submitSigned(tx, parseSignature(signature));
    if (hash) hashes.push(hash);
  }

  const results = await pollResults(hashes);
  const failed = results.find((r: any) => r?.status === "Failure");
  if (failed) throw new Error(failed.txResult?.message || failed.message || "Transaction failed");
  return results[0] ?? { status: "Success", hash: hashes[0] };
}
