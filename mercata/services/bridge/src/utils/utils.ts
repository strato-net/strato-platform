import { getAddress } from "ethers";

/**
 * Converts an amount from one decimal place to another
 * @param amount - The amount as BigInt or string (hex/decimal)
 * @param fromDecimals - Source decimal places
 * @param toDecimals - Target decimal places
 * @returns The converted amount as BigInt
 */
export function convertDecimals(
  amount: string | bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  // Parse the amount to BigInt (handles both hex and decimal strings)
  const amountBigInt = typeof amount === "bigint" ? amount : BigInt(amount);

  if (fromDecimals === toDecimals) {
    return amountBigInt;
  }

  if (fromDecimals > toDecimals) {
    // Need to divide by 10^(fromDecimals - toDecimals)
    const divisor = BigInt(10) ** BigInt(fromDecimals - toDecimals);
    return amountBigInt / divisor;
  } else {
    // Need to multiply by 10^(toDecimals - fromDecimals)
    const multiplier = BigInt(10) ** BigInt(toDecimals - fromDecimals);
    return amountBigInt * multiplier;
  }
}

/**
 * Converts an amount from external token decimals to STRATO decimals
 * @param amount - The amount as BigInt or string (hex/decimal)
 * @param extDecimals - External token decimal places
 * @returns The converted amount as decimal string for STRATO contracts
 */
export function convertToStratoDecimals(
  amount: string | bigint,
  extDecimals: number,
): string {
  const converted = convertDecimals(amount, extDecimals, 18);
  return converted.toString();
}

/**
 * Converts an amount from STRATO decimals to external token decimals
 * @param amount - The amount as BigInt or string (hex/decimal)
 * @param extDecimals - External token decimal places
 * @returns The converted amount as hex string for external chain contracts
 */
export function convertFromStratoDecimals(
  amount: string | bigint,
  extDecimals: number,
): string {
  const converted = convertDecimals(amount, 18, extDecimals);
  return `0x${converted.toString(16)}`;
}

/**
 * Normalizes a 32-byte padded address to a standard 20-byte Ethereum address
 * @param address - The address to normalize (can be 32-byte padded or already normalized)
 * @returns Normalized 20-byte Ethereum address with 0x prefix
 */
export function normalizeAddress(address: string): string {
  if (!address) return address;

  // Remove 0x prefix if present
  const cleanAddress = address.startsWith("0x") ? address.slice(2) : address;

  // If it's already 40 characters (20 bytes), it's already normalized
  if (cleanAddress.length === 40) {
    return `0x${cleanAddress.toLowerCase()}`;
  }

  // If it's 64 characters (32 bytes), extract the last 40 characters
  if (cleanAddress.length === 64) {
    return `0x${cleanAddress.toLowerCase().slice(-40)}`;
  }

  // If it's something else, assume it's already in the right format
  return `0x${cleanAddress.toLowerCase()}`;
}

/**
 * Ensures an address has the 0x prefix
 * @param address - The address to format
 * @returns Address with 0x prefix
 */
export function ensureHexPrefix(address: string): string {
  if (!address) return address;
  return address.startsWith("0x") ? address : `0x${address}`;
}

/**
 * Converts a decimal string to a hex string
 * @param decimalString - The decimal string to convert
 * @returns Hex string with 0x prefix
 */
export function decimalToHex(decimalString: string): string {
  if (!decimalString) return "0x0";
  return `0x${BigInt(decimalString).toString(16)}`;
}

/**
 * Safely converts a value to BigInt
 * @param value - The value to convert (string, number, or BigInt)
 * @returns BigInt representation
 */
export function safeToBigInt(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") {
    const cleanValue = value.trim();
    if (!cleanValue) return 0n;
    return BigInt(cleanValue);
  }
  return 0n;
}

export function safeChecksum(a: string) {
  return getAddress(ensureHexPrefix(a));
}

export function validateAddress(address: string): boolean {
  try {
    safeChecksum(address);
    return true;
  } catch {
    return false;
  }
}
