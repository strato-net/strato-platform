// Local transaction history for the Activity tab. Every send (EVM or STRATO BLOC,
// whether initiated from a dApp or the popup) is recorded here so the user has a
// reverse-chronological log. Kept client-side; capped to a sane maximum.

import { storage } from "wxt/storage";
import type { Address } from "viem";

export type TxStatus = "pending" | "confirmed" | "failed";
export type TxKind = "send" | "contract" | "bloc";

export interface TxRecord {
  hash: string;
  from: string;
  to?: string;
  /** native value in wei, as a decimal string */
  value?: string;
  /** decimal chainId string of the network it was sent on */
  chainId: string;
  timestamp: number;
  status: TxStatus;
  kind: TxKind;
  /** short human title, e.g. "Sent STRATO", "Contract interaction", "transfer()" */
  title: string;
  /** optional signed amount summary, e.g. "-1.5 STRATO" */
  amount?: string;
}

const MAX = 250;
const historyStore = storage.defineItem<TxRecord[]>("local:txHistory", { fallback: [] });

export async function addTx(rec: TxRecord): Promise<void> {
  const all = await historyStore.getValue();
  all.unshift(rec); // newest first
  await historyStore.setValue(all.slice(0, MAX));
}

export async function getTxs(from: Address, chainId: string): Promise<TxRecord[]> {
  const all = await historyStore.getValue();
  return all.filter(
    (t) => t.from.toLowerCase() === from.toLowerCase() && t.chainId === chainId
  );
}
