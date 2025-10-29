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

/**
 * Normalizes a boolean value that may come as an address string.
 * Treats the zero address "0000000000000000000000000000000000000000" as false.
 * @param value - The value to normalize (can be boolean, string, or address)
 * @returns A boolean value
 */
export function normalizeBooleanFromAddress(value: any): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    // Treat zero address as false
    const normalized = value.toLowerCase().replace(/^0x/, '');
    if (normalized === '0000000000000000000000000000000000000000' || normalized === '') {
      return false;
    }
    // For other addresses, treat as truthy if non-empty
    return Boolean(value && value.trim().length > 0);
  }
  // For other types (number, etc.), convert to boolean
  return Boolean(value);
}