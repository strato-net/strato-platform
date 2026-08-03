import { parseJson } from "./eventRecord.mapper";

type IndexedActionableEvents = Record<string, any>;

const parseIndexedActionableEvents = (
  actionableEvents: IndexedActionableEvents
): any[] =>
  Object.keys(actionableEvents)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => actionableEvents[key]);

export const makeEventPairKey = (contract: string, eventName: string): string =>
  `${contract}:${eventName}`;

export const parseActionableEventsForActivities = (
  actionableEvents: unknown
): any[] => {
  let actionableEventsArray: any[] = [];
  if (typeof actionableEvents === "string") {
    try {
      const parsed = JSON.parse(actionableEvents);
      actionableEventsArray = Array.isArray(parsed)
        ? parsed
        : parseIndexedActionableEvents((parsed || {}) as IndexedActionableEvents);
    } catch {
      actionableEventsArray = [];
    }
  }

  return actionableEventsArray;
};

export const parseActionableEventNames = (actionableEvents: unknown): string[] => {
  if (!actionableEvents) return [];

  if (typeof actionableEvents === "string") {
    try {
      return parseActionableEventNames(parseJson(actionableEvents));
    } catch {
      return [];
    }
  }

  if (Array.isArray(actionableEvents)) {
    return actionableEvents
      .map((event) => String(event?.eventName ?? "").trim())
      .filter((eventName) => eventName.length > 0);
  }

  if (typeof actionableEvents === "object") {
    return parseIndexedActionableEvents(actionableEvents as IndexedActionableEvents)
      .map((event) => String(event?.eventName ?? "").trim())
      .filter((eventName) => eventName.length > 0);
  }

  return [];
};
