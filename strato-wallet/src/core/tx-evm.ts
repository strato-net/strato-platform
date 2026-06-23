// Standard EVM transaction path: build an EIP-155 legacy transaction, RLP-encode,
// hash, sign with the keyring, and submit via eth_sendRawTransaction. This is the
// path generic web3 dApps use through eth_sendTransaction.
//
// Field order and the v = chainId*2 + 35 + recovery rule mirror
// smd-ui/src/lib/stratoWallet.ts:63-104 so a STRATO node accepts the result.

import { type Address, type Hex, formatEther, keccak256, toRlp } from "viem";
import { keyring } from "./keyring";
import { rpcCall } from "./rpc";
import type { StratoNetwork } from "./networks";
import { addTx } from "./history";
import { nativeSymbol } from "./networks";

export interface EvmTxRequest {
  from: Address;
  to?: string;
  value?: string; // hex or decimal string
  data?: string;
  gas?: string; // hex
  gasPrice?: string; // hex
  nonce?: string; // hex
}

function toMinimalHex(n: number | bigint): Hex {
  if (n === 0 || n === 0n) return "0x";
  const hex = n.toString(16);
  return `0x${hex.length % 2 ? "0" + hex : hex}` as Hex;
}

function parseMaybeHex(v: string | undefined, fallback = 0n): bigint {
  if (v === undefined) return fallback;
  return v.startsWith("0x") ? BigInt(v) : BigInt(v);
}

/** Sign and broadcast an EVM transaction; returns the transaction hash. */
export async function sendEvmTransaction(
  network: StratoNetwork,
  tx: EvmTxRequest
): Promise<Hex> {
  const from = tx.from;
  const chainId = BigInt(network.chainId);

  const nonce =
    tx.nonce !== undefined
      ? parseMaybeHex(tx.nonce)
      : BigInt(
          (await rpcCall<string>(network.rpcUrl, "eth_getTransactionCount", [
            from,
            "latest",
          ])) ?? "0x0"
        );
  const gasPrice = parseMaybeHex(tx.gasPrice, 0n);
  const gasLimit = parseMaybeHex(tx.gas, 1_000_000n);
  const to = (tx.to || "0x") as Hex;
  const value = parseMaybeHex(tx.value, 0n);
  const data = (tx.data || "0x") as Hex;

  const unsignedFields: Hex[] = [
    toMinimalHex(nonce),
    toMinimalHex(gasPrice),
    toMinimalHex(gasLimit),
    to,
    toMinimalHex(value),
    data,
    toMinimalHex(chainId),
    "0x",
    "0x",
  ];
  const signingHash = keccak256(toRlp(unsignedFields));

  const sig = await keyring.signHash(from, signingHash);
  const eip155V = chainId * 2n + 35n + BigInt(sig.recovery);

  const signedFields: Hex[] = [
    toMinimalHex(nonce),
    toMinimalHex(gasPrice),
    toMinimalHex(gasLimit),
    to,
    toMinimalHex(value),
    data,
    toMinimalHex(eip155V),
    sig.r,
    sig.s,
  ];
  const rawTx = toRlp(signedFields);

  const hash = await rpcCall<Hex>(network.rpcUrl, "eth_sendRawTransaction", [rawTx]);

  const isContract = !!data && data !== "0x";
  const symbol = nativeSymbol(network);
  await addTx({
    hash,
    from,
    to,
    value: value.toString(),
    chainId: network.chainId,
    timestamp: Date.now(),
    status: "confirmed",
    kind: isContract ? "contract" : "send",
    title: isContract ? "Contract interaction" : `Sent ${symbol}`,
    amount: isContract ? undefined : `-${formatEther(value)} ${symbol}`,
  });

  return hash;
}
