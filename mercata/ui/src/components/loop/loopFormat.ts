import { formatUnits } from "@/utils/numberUtils";

export const formatPct = (value: number): string => `${value.toFixed(2)}%`;

export const formatFeeBps = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

export const formatCompact = (value: number): string =>
  Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2, notation: "compact" })
    : "0";

const weiToNumber = (value: string): number => Number(formatUnits(value, 18));

export const formatUsdFromWei = (value: string | undefined): string => {
  if (!value) return "—";
  try {
    return `$${weiToNumber(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  } catch {
    return "—";
  }
};

export const formatWeiCompact = (value: string | undefined): string => {
  if (!value) return "—";
  try {
    const num = weiToNumber(value);
    if (num <= 0) return "None";
    return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  } catch {
    return "—";
  }
};
