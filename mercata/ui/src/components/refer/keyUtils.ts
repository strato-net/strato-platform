// Utilities for splitting a 256-bit secp256k1 private key into:
// - high 206 bits (carried in URL as base64url)
// - low 50 bits (carried by human as base36, 10 chars)

const LOW_BITS = 50n;
const LOW_MASK = (1n << LOW_BITS) - 1n;

// Base64URL (no padding) helpers
export function toBase64Url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bigIntToFixedBytesBE(x: bigint, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  let v = x;
  for (let i = byteLen - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error("bigint too large for byteLen");
  return out;
}

export function bytesBEToBigInt(bytes: Uint8Array): bigint {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x;
}

export function splitPrivateKey(privKeyHexNo0x: string): { hiB64Url: string; loBase36: string } {
  if (privKeyHexNo0x.length !== 64) throw new Error("expected 32-byte privkey hex");
  const priv = BigInt("0x" + privKeyHexNo0x);

  const lo = priv & LOW_MASK;        // 50 bits
  const hi = priv >> LOW_BITS;       // 206 bits

  // 206 bits fit in 26 bytes (208 bits). Top 2 bits will be zero.
  const hiBytes = bigIntToFixedBytesBE(hi, 26);
  const hiB64Url = toBase64Url(hiBytes);

  const loBase36 = lo.toString(36).padStart(10, "0").toLocaleUpperCase(); // 50 bits -> <= 10 base36 chars
  return { hiB64Url, loBase36 };
}

export function joinPrivateKey(hiB64Url: string, loBase36: string): string {
  const hiBytes = fromBase64Url(hiB64Url);
  if (hiBytes.length !== 26) throw new Error("hi part must decode to 26 bytes");

  const hi = bytesBEToBigInt(hiBytes); // should be <= 206 bits, but we allow the full 208 with leading zeros
  const lo = BigInt("0x" + BigInt(parseInt(loBase36, 36)).toString(16)); // safe for 10 chars

  if (lo >= (1n << LOW_BITS)) throw new Error("lo part out of range");

  const priv = (hi << LOW_BITS) | lo;
  const privHex = priv.toString(16).padStart(64, "0");
  return privHex;
}
