/** Price with decimals scaled to its magnitude, or a fixed count when given */
export const formatPrice = (price: number, decimals?: number): string => {
  const digits = decimals ?? (price >= 1000 ? 2 : price >= 1 ? 4 : 6);
  return price.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

/** Token quantity: compact above 100k, otherwise decimals scaled to its magnitude */
export const formatQuantity = (quantity: number): string =>
  quantity >= 100_000
    ? quantity.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })
    : quantity > 0 && quantity < 0.000001
      ? "<0.000001"
      : quantity.toLocaleString(undefined, { maximumFractionDigits: quantity >= 100 ? 2 : quantity >= 1 ? 4 : 6 });
