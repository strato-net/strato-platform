  // Calculate health factor color based on value
  export const getHealthFactorColor = (healthFactor: number) => {
    if (healthFactor >= 1.5) return "text-green-600";
    if (healthFactor >= 1.2) return "text-yellow-600";
    if (healthFactor >= 1.0) return "text-orange-600";
    return "text-red-600";
  };