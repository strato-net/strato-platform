export const applyDepositActionOutcomes = (
  events: any[],
  routedEvents: any[]
): void => {
  const routedByTransaction = new Map(
    routedEvents.map((event) => [
      event.transaction_hash,
      { ...event.attributes, eventName: event.event_name },
    ])
  );
  for (const event of events) {
    const outcome = routedByTransaction.get(event.transaction_hash) as
      | Record<string, string>
      | undefined;
    if (!outcome || event.event_name !== "DepositCompleted") continue;
    if (outcome.eventName === "DepositActionFallback") {
      event.depositOutcome = "fallback";
      event.finalToken = outcome.fallbackToken;
      event.finalAmount = outcome.fallbackAmount;
    } else {
      event.depositOutcome = "route";
      event.finalToken = outcome.finalToken;
      event.finalAmount = outcome.finalAmount;
    }
  }
};
