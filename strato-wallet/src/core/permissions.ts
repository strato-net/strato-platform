// Per-origin connection permissions. A dApp origin must be granted access (via
// the connect approval) before it can read accounts or request signatures.

import { storage } from "wxt/storage";
import type { Address } from "viem";

export interface OriginPermission {
  origin: string;
  accounts: Address[];
  grantedAt: number;
}

const permStore = storage.defineItem<Record<string, OriginPermission>>(
  "local:permissions",
  { fallback: {} }
);

export async function getPermission(origin: string): Promise<OriginPermission | null> {
  const all = await permStore.getValue();
  return all[origin] ?? null;
}

export async function grantPermission(
  origin: string,
  accounts: Address[]
): Promise<void> {
  const all = await permStore.getValue();
  all[origin] = { origin, accounts, grantedAt: Date.now() };
  await permStore.setValue(all);
}

export async function revokePermission(origin: string): Promise<void> {
  const all = await permStore.getValue();
  delete all[origin];
  await permStore.setValue(all);
}

export async function listPermissions(): Promise<OriginPermission[]> {
  return Object.values(await permStore.getValue());
}
