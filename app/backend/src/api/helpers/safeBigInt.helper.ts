/**
 * Lenient string/number -> bigint coercion for Cirrus values.
 * Accepts integers, decimals (truncated), scientific notation, null/undefined (-> 0n).
 */
export const safeBigInt = (value: unknown): bigint => {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  const str = String(value);
  const trimmed = str.trim();
  if (trimmed === "") return 0n;
  if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);

  const sciMatch = trimmed.match(/^(-?\d+\.?\d*)[eE]([+-]?\d+)$/);
  if (sciMatch) {
    const [, mantissa, exponent] = sciMatch;
    const exp = parseInt(exponent, 10);
    const [intPart, decPart = ""] = mantissa.replace("-", "").split(".");
    const isNegative = mantissa.startsWith("-");
    const combined = intPart + decPart;
    const shift = exp - decPart.length;

    let result: string;
    if (shift >= 0) {
      result = combined + "0".repeat(shift);
    } else {
      const cutPoint = combined.length + shift;
      result = cutPoint > 0 ? combined.slice(0, cutPoint) : "0";
    }

    return BigInt(isNegative ? "-" + result : result);
  }

  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return BigInt(trimmed.split(".")[0] || "0");
  }

  return 0n;
};
