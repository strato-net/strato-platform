import { normalizeAddressNoPrefix } from "../../shared/core/address";
import type { CirrusEvent, RoutedExecution } from "../../shared/types";
import { parseJson, ZERO_ADDRESS } from "./eventRecord.mapper";

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


export const indexRouteExecutions = (
  events: Pick<CirrusEvent, "transaction_hash" | "event_index" | "attributes">[],
): Map<string, RoutedExecution[]> => {
  const routes = new Map<string, RoutedExecution[]>();
  for (const event of events) {
    const eventIndex = Number(event.event_index);
    if (!/^(0x)?[a-f0-9]{64}$/i.test(event.transaction_hash || "") ||
        !/^\d+$/.test(String(event.event_index)) || !Number.isSafeInteger(eventIndex)) {
      throw new Error("Invalid router event identity; cannot attribute rewards safely");
    }
    const transactionHash = normalizeAddressNoPrefix(event.transaction_hash);
    const attributes = parseJson(event.attributes);
    const caller = typeof attributes?.caller === "string" && /^(0x)?[a-f0-9]{40}$/i.test(attributes.caller)
      && normalizeAddressNoPrefix(attributes.caller) !== ZERO_ADDRESS ? attributes.caller : undefined;
    const executions = routes.get(transactionHash) || [];
    executions.push({ eventIndex, caller });
    routes.set(transactionHash, executions);
  }
  for (const executions of routes.values()) {
    executions.sort((a, b) => a.eventIndex - b.eventIndex);
    if (executions.some((execution, index) => index > 0 && execution.eventIndex === executions[index - 1].eventIndex)) {
      throw new Error("Duplicate router event index; cannot attribute rewards safely");
    }
  }
  return routes;
};

export const getRoutedActivityCaller = (
  routes: Map<string, RoutedExecution[]>, transactionHash: string, eventIndex: number,
): string | undefined => {
  if (!transactionHash || !Number.isSafeInteger(eventIndex) || eventIndex < 0) return undefined;
  // TokenRouter is non-reentrant and emits RouteExecuted after the route's activities.
  return routes.get(normalizeAddressNoPrefix(transactionHash))?.find(route => route.eventIndex > eventIndex)?.caller;
};
