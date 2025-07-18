export const weiToEth = (v?: string | number | bigint | null): number => {
  if (v === undefined || v === null) return 0;
  try {
    return Number(BigInt(v)) / 1e18;
  } catch {
    return 0;
  }
};

export const ethToWei = (eth: number): string => {
  if (!isFinite(eth) || eth <= 0) return "0";
  return BigInt(Math.floor(eth * 1e18)).toString();
};