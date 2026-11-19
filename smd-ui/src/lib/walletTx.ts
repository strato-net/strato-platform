import type { WalletClient } from "viem";
import { api } from "@/lib/api";
import { parseArgText } from "@/lib/args";
import { env, runtime } from "@/lib/env";
import {
  deriveCanonicalUserAddress,
  fetchUserRegistryCodeHash,
  strip0x,
} from "@/services/userWallets";
import { fetchFunctionByAddress } from "@/services/contracts";

// External-wallet transaction signing, ported from the STRATO App's flow:
//   1. POST /bloc/v2.2/transaction/unsigned  -> unsigned tx(s) with per-tx data
//   2. walletClient.signTypedData(...)        -> STRATO EIP-712 signature
//   3. POST /strato-api/eth/v1.2/transaction  -> submit signed tx
//   4. POST /bloc/v2.2/transactions/results   -> poll until resolved
// Used when an EXTERNAL wallet is connected (no STRATO vault session). The STRATO
// session path stays on /strato/v2.3/transaction (server-side vault signing).

// Fallback for the EIP-712 `network` field when the unsigned response omits it.
// Prefer the node's own value (e.g. "mercata"): the signature and the node's
// canonical tx hash are both computed over it, and the app's reference flow
// signs whatever the unsigned endpoint returns.
const SIGNING_NETWORK = "STRATO";

export type StratoTxType = "CONTRACT" | "FUNCTION" | "TRANSFER";

export interface UnsignedTx {
  hash?: string;
  data: {
    nonce: number | string;
    gasLimit: number | string;
    to: string;
    functionName?: string;
    args?: string[];
    network?: string;
    chainId: number | string;
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

/**
 * Marker header for the CSRF exemption on the node's self-custody tx endpoints
 * (nginx csrf.lua `wallet_tx_routes`): guests have no session, so their browser
 * POSTs would otherwise be rejected. The real authentication is the tx signature.
 */
const walletHeaders = (userAddress: string) => ({
  "X-Wallet-Address": userAddress.replace(/^0x/, ""),
});

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
    // Callers surface tx failures themselves, so skip the global error toast.
    {
      params: { ...chainParam(), ...(username ? { username } : {}) },
      headers: walletHeaders(userAddress),
      skipErrorToast: true,
    }
  );
  // Tolerate a few shapes: a raw array, or a wrapper with _unsignedTxs / txs.
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?._unsignedTxs)) return data._unsignedTxs;
  if (Array.isArray(data?.txs)) return data.txs;
  return [];
}

const normalizedValue = (value: unknown): unknown => {
  if (value && typeof value === "object" && !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, "type") &&
      Object.prototype.hasOwnProperty.call(value, "value")) {
    const typed = value as { type: unknown; value: unknown };
    const type = String(typed.type).toLowerCase();
    if (type === "string") return String(typed.value);
    if (type === "address" || type === "account") return strip0x(String(typed.value));
    return normalizedValue(typed.value);
  }
  if (Array.isArray(value)) return value.map(normalizedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizedValue(item)])
    );
  }
  if (typeof value === "bigint" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^(0x)?[0-9a-f]{40}$/i.test(trimmed)) return strip0x(trimmed);
  }
  return value;
};

const splitNodeList = (value: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[" || char === "(" || char === "{") {
      depth++;
    } else if (char === "]" || char === ")" || char === "}") {
      depth--;
    } else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) parts.push(last);
  return parts;
};

/** Decode the SolidVM source literals returned by bloc's unsigned endpoint. */
export const parseUnsignedArgument = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? splitNodeList(inner).map(parseUnsignedArgument) : [];
  }
  const cast = trimmed.match(/^[A-Za-z_][A-Za-z0-9_]*\(([\s\S]*)\)$/);
  if (cast) return parseUnsignedArgument(cast[1]);
  if (/^-?\d+$/.test(trimmed) && !Number.isSafeInteger(Number(trimmed))) return trimmed;
  return parseArgText(trimmed);
};

const decodedUnsignedArgs = (tx: UnsignedTx): unknown[] =>
  (tx.data.args ?? []).map((value) => normalizedValue(parseUnsignedArgument(value)));

const isTypedValue = (value: unknown): boolean =>
  !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.prototype.hasOwnProperty.call(value, "type") &&
  Object.prototype.hasOwnProperty.call(value, "value");

const requestedArguments = (
  payload: Record<string, unknown>,
  argumentNames?: string[]
): unknown[] => {
  const args = (payload.args && typeof payload.args === "object" ? payload.args : {}) as Record<string, unknown>;
  const entries = argumentNames?.length
    ? argumentNames.map((name) => [name, args[name]] as const)
    : Object.entries(args);
  return entries.flatMap(([key, value]) =>
    Array.isArray(value) && (
      value.every(isTypedValue) && value.length > 0 ||
      key === "_arguments" ||
      key === "_args"
    )
      ? value.map(normalizedValue)
      : [normalizedValue(value)]
  );
};

const flattened = (values: unknown[]): unknown[] =>
  values.flatMap((value) => Array.isArray(value) ? flattened(value) : [value]);

const sameSequence = (values: unknown[], expected: unknown[]): boolean => {
  const actual = flattened(values);
  const wanted = flattened(expected);
  return actual.length === wanted.length &&
    wanted.every((value, index) =>
      JSON.stringify(normalizedValue(actual[index])) === JSON.stringify(normalizedValue(value))
    );
};

/** Refuse to sign when bloc's unsigned transaction does not represent the requested action. */
export function validateUnsignedTx(
  tx: UnsignedTx,
  type: StratoTxType,
  payload: Record<string, unknown>,
  expectedChainId: number | null,
  userWalletAddress?: string,
  argumentNames?: string[]
): void {
  const d = tx.data;
  if (expectedChainId !== null && String(d.chainId) !== String(expectedChainId)) {
    throw new Error("The node returned a transaction for a different network, so it was not signed.");
  }
  if (type !== "FUNCTION" && type !== "CONTRACT") return;

  const expectedTarget = type === "FUNCTION"
    ? strip0x(String(payload.contractAddress ?? ""))
    : "";
  const expectedFunction = type === "FUNCTION"
    ? String(payload.method ?? "")
    : "createContract";
  const expectedArguments = requestedArguments(payload, argumentNames);
  const returnedArguments = decodedUnsignedArgs(tx);
  const direct = type === "FUNCTION" &&
    strip0x(d.to) === expectedTarget &&
    (d.functionName ?? "") === expectedFunction &&
    sameSequence(returnedArguments, expectedArguments);
  if (direct) return;

  const wallet = strip0x(userWalletAddress ?? "");
  if (!wallet) throw new Error("This transaction could not be verified, so it was not signed.");
  const requestedCall = type === "FUNCTION"
    ? [expectedTarget, expectedFunction, ...expectedArguments]
    : [
        String(payload.contract ?? ""),
        String(payload.src ?? ""),
        ...expectedArguments,
      ];
  const wrappedDirect = strip0x(d.to) === wallet &&
    (d.functionName === expectedFunction || d.functionName === "callContract" || d.functionName === "createContract") &&
    sameSequence(returnedArguments, requestedCall);
  const wrappedVote = d.functionName === "castVoteOnIssue" &&
    sameSequence(returnedArguments, [wallet, type === "FUNCTION" ? "callContract" : "createContract", ...requestedCall]);
  if (!wrappedDirect && !wrappedVote) {
    throw new Error("This transaction could not be verified, so it was not signed.");
  }
}

async function signOne(walletClient: WalletClient, tx: UnsignedTx): Promise<string> {
  const d = tx.data;
  const chainId = Number(d.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Invalid STRATO transaction chain ID");
  }
  return walletClient.signTypedData({
    account: walletClient.account!,
    domain: { name: "STRATO", version: "1", chainId },
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
      network: d.network ?? SIGNING_NETWORK,
    },
  });
}

async function submitSigned(
  tx: UnsignedTx,
  sig: { r: string; s: string; v: string },
  userAddress: string
): Promise<string> {
  const signedTx = {
    nonce: tx.data.nonce,
    gasLimit: tx.data.gasLimit,
    to: tx.data.to,
    funcName: tx.data.functionName,
    args: tx.data.args,
    network: tx.data.network ?? SIGNING_NETWORK,
    chainId: tx.data.chainId,
    r: sig.r,
    s: sig.s,
    v: sig.v,
    txVersion: 1,
  };
  const { data } = await api.post(`${env.STRATO_URL}/transaction`, signedTx, {
    params: chainParam(),
    headers: walletHeaders(userAddress),
    skipErrorToast: true,
  });
  return typeof data === "string" ? data : data?.hash ?? tx.hash ?? "";
}

export async function pollResults(
  hashes: string[],
  userAddress: string,
  timeout = 60000,
  interval = 3000
): Promise<any[]> {
  const start = Date.now();
  while (true) {
    const { data: results } = await api.post(`${env.BLOC_URL}/transactions/results`, hashes, {
      headers: walletHeaders(userAddress),
      skipErrorToast: true,
    });
    const list = Array.isArray(results) ? results : [];
    if (hashes.length > 0 && hashes.every((hash) => list.some((r: any) =>
      r?.hash?.replace(/^0x/, "") === hash.replace(/^0x/, "") &&
      (r.status === "Success" || r.status === "Failure")
    ))) return list;
    if (Date.now() - start >= timeout) throw new Error("Transaction confirmation timed out; check its status before retrying");
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
  if (unsigned.length === 0) throw new Error("The node did not return a transaction to sign. Try again.");
  const userWalletAddress = options?.username
    ? deriveCanonicalUserAddress(options.username, await fetchUserRegistryCodeHash())
    : undefined;
  const functionInfo = type === "FUNCTION"
    ? await fetchFunctionByAddress(
        String(payload.contractAddress ?? ""),
        String(payload.method ?? "")
      )
    : undefined;
  if (functionInfo && !functionInfo.found) {
    throw new Error("This contract could not be checked, so nothing was signed.");
  }
  const argumentNames = functionInfo?.args.map((argument) => argument.name);

  const hashes: string[] = [];
  for (const tx of unsigned) {
    validateUnsignedTx(tx, type, payload, runtime.chainId(), userWalletAddress, argumentNames);
    const signature = await signOne(walletClient, tx);
    const hash = await submitSigned(tx, parseSignature(signature), userAddress);
    if (hash) hashes.push(hash);
  }

  const results = await pollResults(hashes, userAddress);
  const failed = results.find((r: any) => r?.status === "Failure");
  if (failed) throw new Error(failed.txResult?.message || failed.message || "Transaction failed");
  return results[0];
}
