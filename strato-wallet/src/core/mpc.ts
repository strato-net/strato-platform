// MPC (2-of-2) key support. A full secp256k1 key is split into two additive
// shards d = (a + b) mod n: the wallet keeps shard A (encrypted in the keyring),
// Vault stores shard B. To sign, the wallet fetches shard B, reconstructs d in
// memory, signs, and discards it — Vault never assembles the key or signs.
//
// This is reconstruct-to-sign (client side), not true threshold ECDSA. The
// security win over a Vault-holds-the-whole-key model: neither party stores the
// full key at rest, so a Vault DB breach or a stolen token alone can't sign.

import type { Hex } from "viem";

// secp256k1 group order.
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function to32Hex(x: bigint): Hex {
  return `0x${x.toString(16).padStart(64, "0")}`;
}
function fromHex(h: string): bigint {
  return BigInt(h.startsWith("0x") ? h : `0x${h}`);
}
function randScalar(): bigint {
  // Uniform-ish scalar in [1, n-1].
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return (x % (N - 1n)) + 1n;
}

/** Split a private key d into additive 2-of-2 shards: d = (a + b) mod n. */
export function splitKey(privHex: string): { shardA: Hex; shardB: Hex } {
  const d = ((fromHex(privHex) % N) + N) % N;
  const a = randScalar();
  const b = ((d - a) % N + N) % N;
  return { shardA: to32Hex(a), shardB: to32Hex(b) };
}

/** Reconstruct d = (a + b) mod n from the two shards (32-byte 0x hex). */
export function reconstructKey(shardAHex: string, shardBHex: string): Hex {
  const d = ((fromHex(shardAHex) + fromHex(shardBHex)) % N + N) % N;
  return to32Hex(d);
}

// Shard hex is sent/received without the 0x prefix (the Vault hex-decodes it).
const strip0x = (h: string) => h.replace(/^0x/, "");

/** Store the Vault shard (shard B) for the authenticated user. */
export async function postMpcShard(
  mpcKeyUrl: string,
  accessToken: string,
  shardBHex: string,
  addressHex: string
): Promise<void> {
  const res = await fetch(mpcKeyUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ shard: strip0x(shardBHex), address: strip0x(addressHex).toLowerCase() }),
  });
  if (!res.ok) {
    throw new Error(`MPC key store failed (${res.status}): ${await res.text()}`);
  }
}

/** Fetch the Vault shard (shard B); returns 0x-prefixed hex. */
export async function getMpcShard(mpcKeyUrl: string, accessToken: string): Promise<Hex> {
  const res = await fetch(mpcKeyUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`MPC shard fetch failed (${res.status}): ${await res.text()}`);
  const j = await res.json();
  if (!j?.shard) throw new Error("Vault returned no MPC shard");
  return `0x${strip0x(String(j.shard))}`;
}
