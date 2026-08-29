const normalizeAddress = (address?: string): string =>
  (address || "").toLowerCase().replace(/^0x/, "");

export const shouldSkipRouteReward = ({
  eventAddress,
  eventName,
  caller,
  tokenRouter,
  externalAssetBridge,
}: {
  eventAddress: string;
  eventName: string;
  caller?: string;
  tokenRouter?: string;
  externalAssetBridge?: string;
}): boolean => {
  if (
    eventName !== "RouteExecuted" ||
    normalizeAddress(eventAddress) !== normalizeAddress(tokenRouter)
  ) {
    return false;
  }
  const bridge = normalizeAddress(externalAssetBridge);
  return !bridge || normalizeAddress(caller) === bridge;
};
