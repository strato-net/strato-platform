/** Shared deep links for portfolio / deposit asset rows (mirrors AssetsList routing). */

export const isSaveUsdstAsset = (asset: { _symbol?: string; _name?: string } | null | undefined): boolean => {
  const symbol = asset?._symbol?.toLowerCase?.() || "";
  const name = asset?._name?.toLowerCase?.() || "";
  return symbol === "saveusdst" || name.includes("save usdst") || name.includes("saveusdst");
};

const CARRY_VAULT_SHARE_MAP: Record<string, string> = {
  carryeth: "eth-carry",
  carrywbtc: "wbtc-carry",
};

export const getCarryVaultKey = (asset: { _symbol?: string; _name?: string } | null | undefined): string | null => {
  const symbol = asset?._symbol?.toLowerCase?.() || "";
  return CARRY_VAULT_SHARE_MAP[symbol] ?? null;
};

export const getPortfolioAssetHref = (asset: { address?: string; _symbol?: string; _name?: string } | null | undefined): string => {
  if (isSaveUsdstAsset(asset)) {
    return "/dashboard/earn-save";
  }
  const carryKey = getCarryVaultKey(asset);
  if (carryKey) {
    return `/dashboard/earn-yield-vault?vault=${carryKey}`;
  }
  return `/dashboard/deposits/${asset?.address || ""}`;
};
