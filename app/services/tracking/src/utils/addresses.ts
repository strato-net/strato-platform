// Cirrus stores addresses as lowercase hex without the 0x prefix; every
// address must pass through here before storage or matching.
export const toCirrusAddress = (address: string): string =>
  address.toLowerCase().replace(/^0x/, "");

const ADDRESS_RE = /^[0-9a-f]{40}$/;

// Returns the normalized address, or null when the input is not a valid
// 20-byte hex address.
export const normalizeAddress = (address: unknown): string | null => {
  if (typeof address !== "string" || address.length === 0) return null;
  const normalized = toCirrusAddress(address.trim());
  return ADDRESS_RE.test(normalized) ? normalized : null;
};
