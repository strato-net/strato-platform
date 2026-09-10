const normalizeAddress = (address?: string): string =>
  (address || "").toLowerCase().replace(/^0x/, "");

export const resolveRoutedActivityUser = ({
  attributedUser,
  routedCaller,
  tokenRouter,
  externalAssetBridge,
}: {
  attributedUser?: string;
  routedCaller?: string;
  tokenRouter?: string;
  externalAssetBridge?: string;
}): string | null => {
  if (normalizeAddress(attributedUser) !== normalizeAddress(tokenRouter)) {
    return attributedUser || null;
  }
  const bridge = normalizeAddress(externalAssetBridge);
  if (
    !bridge ||
    !routedCaller ||
    normalizeAddress(routedCaller) === bridge
  ) {
    return null;
  }
  return routedCaller;
};
