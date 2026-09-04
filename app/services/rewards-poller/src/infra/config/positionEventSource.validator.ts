import { normalizeAddressNoPrefix } from "../../shared/core/address";
import { PositionEventSource, PositionEventRule } from "../../shared/types";

type RawPositionEventSource = Omit<PositionEventSource, "events"> & {
  events: Record<string, PositionEventRule>;
};

const requireString = (value: unknown, label: string): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
};

const resolveSourceContract = (value: unknown): string => {
  const configured = requireString(value, "position event sourceContract");
  const address = normalizeAddressNoPrefix(configured);
  if (!/^[a-f0-9]{40}$/.test(address)) {
    throw new Error(`Invalid position event sourceContract: ${configured}`);
  }
  return address;
};

const requireAction = (
  value: unknown,
  label: string
): PositionEventRule["action"] => {
  if (value !== "Deposit" && value !== "Withdraw") {
    throw new Error(`${label} must be Deposit or Withdraw`);
  }
  return value;
};

export const parsePositionEventSources = (
  rawSources: unknown
): PositionEventSource[] => {
  if (!Array.isArray(rawSources)) {
    throw new Error("Position event source configuration must be an array");
  }

  const sources = rawSources.map((raw, sourceIndex) => {
    const source = raw as RawPositionEventSource;
    const targetActivitySourceAttribute = requireString(
      source?.targetActivitySourceAttribute,
      `position event source ${sourceIndex} targetActivitySourceAttribute`
    );
    const eventEntries = Object.entries(source?.events || {});
    if (!eventEntries.length) {
      throw new Error(`Position event source ${sourceIndex} requires at least one event`);
    }

    const events = Object.fromEntries(eventEntries.map(([eventName, eventRule]) => [
      requireString(eventName, `position event source ${sourceIndex} event name`),
      {
        action: requireAction(
          eventRule?.action,
          `position event source ${sourceIndex} ${eventName} action`
        ),
        userAttribute: requireString(
          eventRule?.userAttribute,
          `position event source ${sourceIndex} ${eventName} userAttribute`
        ),
        amountAttribute: requireString(
          eventRule?.amountAttribute,
          `position event source ${sourceIndex} ${eventName} amountAttribute`
        ),
      },
    ]));

    return {
      sourceContract: resolveSourceContract(source?.sourceContract),
      targetActivitySourceAttribute,
      events,
    };
  });

  const sourceEventPairs = new Set<string>();
  for (const source of sources) {
    for (const eventName of Object.keys(source.events)) {
      const pair = `${source.sourceContract}:${eventName}`;
      if (sourceEventPairs.has(pair)) {
        throw new Error(`Duplicate position event source mapping: ${pair}`);
      }
      sourceEventPairs.add(pair);
    }
  }

  return sources;
};
