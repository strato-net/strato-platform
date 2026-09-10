const eventKey = (event: any): string =>
  `${event.transaction_hash}:${event.address}:${event.event_index}`;

export const applyDepositActionOutcomes = (
  events: any[],
  routedEvents: any[]
): void => {
  const groups = new Map<string, any[]>();
  for (const event of routedEvents) {
    const key = `${event.transaction_hash}:${event.address}`;
    const group = groups.get(key) || [];
    group.push(event);
    groups.set(key, group);
  }
  const outcomes = new Map<string, any>();
  for (const group of groups.values()) {
    // Ambiguous ordering must never assign an outcome to a different deposit.
    if (group.some((event) => event.event_index == null || !/^\d+$/.test(String(event.event_index))) ||
        new Set(group.map((event) => String(event.event_index))).size !== group.length) continue;
    group.sort((a, b) => BigInt(a.event_index) < BigInt(b.event_index) ? -1 : 1);
    let pending: any;
    for (const event of group) {
      if (event.event_name !== "DepositCompleted") {
        pending = event;
        continue;
      }
      const source = event.attributes || {};
      const outcome = pending?.attributes;
      if (outcome && source.externalChainId != null && source.externalTxHash && source.stratoRecipient &&
          source.externalChainId === outcome.externalChainId &&
          source.externalTxHash === outcome.externalTxHash &&
          source.stratoRecipient === outcome.recipient) {
        outcomes.set(eventKey(event), pending);
      }
      pending = undefined;
    }
  }
  for (const event of events) {
    if (event.event_name !== "DepositCompleted") continue;
    const outcome = outcomes.get(eventKey(event));
    if (!outcome) continue;
    const attributes = outcome.attributes;
    const fallback = outcome.event_name === "DepositActionFallback";
    event.depositOutcome = fallback ? "fallback" : "route";
    event.finalToken = fallback ? attributes.fallbackToken : attributes.finalToken;
    event.finalAmount = fallback ? attributes.fallbackAmount : attributes.finalAmount;
  }
};
