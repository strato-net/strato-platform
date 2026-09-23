import { normalizeAddressNoPrefix } from "../../shared/core/address";
import { ZERO_ADDRESS } from "./eventRecord.mapper";

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
  if (normalizeAddressNoPrefix(attributedUser || "") !== normalizeAddressNoPrefix(tokenRouter || "")) {
    return attributedUser || null;
  }
  const bridge = normalizeAddressNoPrefix(externalAssetBridge || "");
  if (
    !/^[a-f0-9]{40}$/.test(bridge) ||
    bridge === ZERO_ADDRESS ||
    !routedCaller ||
    normalizeAddressNoPrefix(routedCaller) === bridge
  ) {
    return null;
  }
  return routedCaller;
};
