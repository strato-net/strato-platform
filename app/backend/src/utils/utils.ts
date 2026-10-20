export function extractContractName(token: string): string {
  const parts = token.split("-");
  return parts.length ? parts[parts.length - 1] : token;
}

export function ensureHexPrefix(address: string): string {
  if (!address) return address;
  return address.startsWith('0x') ? address : `0x${address}`;
}

export const ensure = (ok: boolean, msg: string) => { 
  if (!ok) throw new Error(msg); 
};
// Memoizes an async loader per key and shares in-flight calls; results are kept for ttlMs after
// they settle (0 = share in-flight calls only), and failures are not cached.
export const ttlCache = <T>(ttlMs: number) => {
  const entries = new Map<string, { value: Promise<T>; expiresAt: number }>();
  const get = (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const entry = { value: load(), expiresAt: Infinity };
    entries.set(key, entry);
    entry.value.then(
      () => {
        entry.expiresAt = Date.now() + ttlMs;
        if (ttlMs === 0 && entries.get(key) === entry) entries.delete(key);
      },
      () => { if (entries.get(key) === entry) entries.delete(key); }
    );
    return entry.value;
  };
  return Object.assign(get, { clear: () => entries.clear(), delete: (key: string) => entries.delete(key) });
};
