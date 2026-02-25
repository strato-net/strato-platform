import { parseActionableEventNames } from "./actionableEvents.parser";

export const isDirectPayoutEnabled = (directPayout: unknown): boolean =>
  directPayout === true ||
  directPayout === "true" ||
  directPayout === "1" ||
  directPayout === 1;

export const collectDirectPayoutEventsForToken = (
  directPayoutEventsByToken: Map<string, Set<string>>,
  requestedBonusTokens: Set<string>,
  sourceContract: string,
  directPayout: unknown,
  actionableEvents: unknown
): void => {
  if (
    !requestedBonusTokens.has(sourceContract) ||
    !isDirectPayoutEnabled(directPayout)
  ) {
    return;
  }

  for (const eventName of parseActionableEventNames(actionableEvents)) {
    const events = directPayoutEventsByToken.get(sourceContract) ?? new Set<string>();
    events.add(eventName);
    directPayoutEventsByToken.set(sourceContract, events);
  }
};

export const resolveDirectPayoutEventsByToken = (
  requestedBonusTokens: Set<string>,
  directPayoutEventsByToken: Map<string, Set<string>>
): Map<string, string> => {
  const bonusEventByToken = new Map<string, string>();
  const ambiguous: string[] = [];

  for (const token of requestedBonusTokens) {
    const events = directPayoutEventsByToken.get(token);
    if (!events || events.size === 0) {
      continue;
    }

    if (events.size > 1) {
      ambiguous.push(`${token}=>[${[...events].join(",")}]`);
      continue;
    }

    bonusEventByToken.set(token, [...events][0]);
  }

  if (ambiguous.length > 0) {
    const details = [
      ambiguous.length > 0
        ? `multiple direct payout events per token (ambiguous): ${ambiguous.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");

    throw new Error(`Invalid direct payout activity mapping: ${details}`);
  }

  return bonusEventByToken;
};
