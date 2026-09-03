import {
  CirrusEvent,
  PositionActivityRoutes,
  PositionEventSource,
  ProtocolEvent,
} from "../../shared/types";
import { normalizeAddressNoPrefix } from "../../shared/core/address";
import { parseJson } from "./eventRecord.mapper";

export const addPositionActivityRoute = (
  routesBySource: PositionActivityRoutes,
  sourceContract: string,
  eventName: string,
  actionType: unknown
): void => {
  const normalizedAction = String(actionType ?? "").trim().toLowerCase();
  const action = normalizedAction === "0" || normalizedAction === "deposit"
    ? "Deposit"
    : normalizedAction === "1" || normalizedAction === "withdraw"
      ? "Withdraw"
      : null;
  if (!action) return;

  const source = normalizeAddressNoPrefix(sourceContract);
  const routes = routesBySource.get(source) || {};
  routes[action] ||= eventName;
  routesBySource.set(source, routes);
};

const requireAttribute = (
  attributes: Record<string, any>,
  attributeName: string,
  eventName: string
): unknown => {
  const value = attributes[attributeName];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${eventName} is missing required attribute '${attributeName}'`);
  }
  return value;
};

export const mapPositionSourceEvent = (
  item: CirrusEvent,
  sources: PositionEventSource[],
  activityRoutes: PositionActivityRoutes
): ProtocolEvent | null => {
  const sourceAddress = normalizeAddressNoPrefix(item.address);
  const source = sources.find((candidate) => candidate.sourceContract === sourceAddress);
  const rule = source?.events[item.event_name];
  if (!source || !rule) return null;

  const attributes = parseJson(item.attributes) as Record<string, any>;
  const targetActivitySource = normalizeAddressNoPrefix(String(requireAttribute(
    attributes,
    source.targetActivitySourceAttribute,
    item.event_name
  )));
  const user = normalizeAddressNoPrefix(String(requireAttribute(
    attributes,
    rule.userAttribute,
    item.event_name
  )));
  const amount = String(requireAttribute(
    attributes,
    rule.amountAttribute,
    item.event_name
  ));

  if (!/^[a-f0-9]{40}$/.test(targetActivitySource)) {
    throw new Error(`${item.event_name} has invalid target activity source`);
  }
  if (!/^[a-f0-9]{40}$/.test(user)) {
    throw new Error(`${item.event_name} has invalid user`);
  }
  if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new Error(`${item.event_name} has invalid amount`);
  }
  const targetEvent = activityRoutes.get(targetActivitySource)?.[rule.action];
  if (!targetEvent) return null;

  return {
    address: targetActivitySource,
    event_name: targetEvent,
    block_number: Number(item.block_number),
    block_timestamp: item.block_timestamp,
    event_index: Number(item.event_index),
    transaction_sender: user,
    amount,
  };
};
