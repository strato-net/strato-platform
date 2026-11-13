/** Decimals a price of this magnitude is shown with */
export const priceDecimals = (price: number): number => (price >= 1000 ? 2 : price >= 1 ? 4 : 6);

/** Price with decimals scaled to its magnitude, or a fixed count when given */
export const formatPrice = (price: number, decimals = priceDecimals(price)): string =>
  price.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Dollar amount: cents below $1,000, whole dollars from there */
export const formatUsd = (amount: number): string =>
  `$${amount.toLocaleString(undefined, { maximumFractionDigits: amount >= 1000 ? 0 : 2 })}`;

/** Token quantity: compact above 100k, otherwise decimals scaled to its magnitude */
export const formatQuantity = (quantity: number): string =>
  quantity >= 100_000
    ? quantity.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })
    : quantity > 0 && quantity < 0.000001
      ? "<0.000001"
      : quantity.toLocaleString(undefined, { maximumFractionDigits: quantity >= 100 ? 2 : quantity >= 1 ? 4 : 6 });

/**
 * A token amount (18-decimal base units) as text for the amount box, rounded down: six
 * significant digits by default, every digit when `significant` is Infinity.
 */
export const amountText = (units: bigint, significant = 6): string => {
  const digits = units.toString().padStart(19, "0");
  const whole = digits.slice(0, -18);
  const fraction = digits.slice(-18);
  const decimals = whole === "0" ? fraction.search(/[1-9]/) + significant : significant - whole.length;
  const kept = fraction.slice(0, Math.max(0, decimals)).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole;
};

/** A token amount (18-decimal base units) for display: six significant digits, rounded down */
export const formatTokens = (units: bigint): string => {
  const [whole, fraction] = amountText(units).split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction}` : grouped;
};
