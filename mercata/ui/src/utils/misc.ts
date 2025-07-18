import { formatUnits } from "ethers";

export const generatePriceData = (basePrice: number, days: number = 30) => {
  const data = [];
  let currentPrice = basePrice;

  for (let i = 0; i < days; i++) {
    // Random price fluctuation between -2% and +2%
    const change = currentPrice * (Math.random() * 0.04 - 0.02);
    currentPrice += change;

    data.push({
      date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000).toLocaleDateString(),
      price: formatUnits(currentPrice?.toLocaleString("fullwide", { useGrouping: false }), 18),
    });
  }

  return data;
};

// Calculate health factor color based on value
export const getHealthFactorColor = (healthFactor: number) => {
  if (healthFactor >= 1.5) return "text-green-600";
  if (healthFactor >= 1.2) return "text-yellow-600";
  if (healthFactor >= 1.0) return "text-orange-600";
  return "text-red-600";
};