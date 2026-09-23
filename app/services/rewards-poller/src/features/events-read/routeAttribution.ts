import { normalizeAddressNoPrefix } from "../../shared/core/address";
import { ZERO_ADDRESS } from "./eventRecord.mapper";

export const resolveRoutedActivityUser = ({
  attributedUser,
  routedCaller,
  tokenRouter,
  externalAssetBridge,
  nativeBridge,
}: {
  attributedUser?: string;
  routedCaller?: string;
  tokenRouter?: string;
  externalAssetBridge?: string;
  nativeBridge?: string;
}): string | null => {
  if (normalizeAddressNoPrefix(attributedUser || "") !== normalizeAddressNoPrefix(tokenRouter || "")) {
    return attributedUser || null;
  }
  const bridge = normalizeAddressNoPrefix(externalAssetBridge || "");
  const native = normalizeAddressNoPrefix(nativeBridge || "");
  if (
    !/^[a-f0-9]{40}$/.test(native) || native === ZERO_ADDRESS ||
    !/^[a-f0-9]{40}$/.test(bridge) ||
    bridge === ZERO_ADDRESS ||
    !routedCaller ||
    normalizeAddressNoPrefix(routedCaller) === bridge ||
    normalizeAddressNoPrefix(routedCaller) === native
  ) {
    return null;
  }
  return routedCaller;
};
