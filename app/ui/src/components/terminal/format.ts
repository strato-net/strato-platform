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
