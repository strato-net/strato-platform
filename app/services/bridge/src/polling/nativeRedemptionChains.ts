/**
 * Chains the native redemption poller must watch.
 *
 * Native representation routes live on StratoNativeBridge and are independent of
 * the MercataBridge deposit chains. A chain can carry a native route (for example
 * an exchange's own L2) without a DepositRouter, so polling only the deposit
 * chains would mint representation tokens there but never record redemptions.
 * Both sources are merged so existing deposit chains keep being polled.
 */
export const collectNativeRedemptionChainIds = (
  ...sources: ReadonlyArray<ReadonlyArray<number | string | null | undefined>>
): number[] => {
  const chainIds = new Set<number>();

  for (const source of sources) {
    for (const value of source) {
      const chainId = Number(value);
      if (Number.isSafeInteger(chainId) && chainId > 0) {
        chainIds.add(chainId);
      }
    }
  }

  return Array.from(chainIds).sort((left, right) => left - right);
};
