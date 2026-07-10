import { useEffect, useState } from "react";
import { activityFeedApi } from "@/lib/activityFeed";
import { activityTypes } from "@/components/dashboard/activityTypes";
import { useUser } from "@/context/UserContext";

/**
 * Net token flows (deposits minus withdrawals) per token address, as a raw
 * on-chain amount string. Positive = net acquired.
 */
export type NetFlowsByAddress = Record<string, string>;

const norm = (v?: string | null): string =>
  (v || "").toLowerCase().replace(/^0x/, "");

// Transfer-style events where the amount is a token quantity we can net out.
const TRANSFER_PAIRS = Object.values(activityTypes)
  .filter((c) => c.event_name === "Transfer")
  .map((c) => ({
    contract_name: c.contract_name,
    event_name: c.event_name,
    filterConfig: c.filterConfig,
  }));

const PAGE = 200;
const MAX_PAGES = 25; // safety cap: 5k events

/**
 * Flows-based estimated P&L input.
 *
 * v1 approach (see the "Estimated P&L" tooltip in the UI for user-facing
 * caveats): page the user's Transfer activity and net deposits vs. withdrawals
 * per token. `usePortfolio` turns these raw net flows into an invested/
 * unrealized estimate by comparing the net-deposited quantity to the current
 * balance/value. This captures quantity accrual (e.g. rebasing yield) but does
 * NOT know historical acquisition prices, so it does not capture price
 * appreciation and is intentionally approximate. Returns an empty map until the
 * fetch resolves or when disabled (guest / logged-out).
 */
export const usePortfolioPnL = (enabled: boolean): NetFlowsByAddress => {
  const { userAddress } = useUser();
  const [flows, setFlows] = useState<NetFlowsByAddress>({});

  useEffect(() => {
    if (!enabled || !userAddress || TRANSFER_PAIRS.length === 0) {
      setFlows({});
      return;
    }

    let cancelled = false;
    const user = norm(userAddress);

    (async () => {
      const acc: Record<string, bigint> = {};
      let offset = 0;

      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await activityFeedApi.getActivities(TRANSFER_PAIRS, {
          myActivity: true,
          limit: PAGE,
          offset,
        });
        const events = res.events || [];

        for (const e of events) {
          const from = norm(e.attributes.from || e.attributes.From);
          const to = norm(e.attributes.to || e.attributes.To);
          const raw = e.attributes.value || e.attributes.Value || "0";
          const addr = norm(e.address);
          if (!addr) continue;

          let v: bigint;
          try {
            v = BigInt(raw);
          } catch {
            continue;
          }

          if (to === user) acc[addr] = (acc[addr] || 0n) + v;
          if (from === user) acc[addr] = (acc[addr] || 0n) - v;
        }

        if (events.length < PAGE) break;
        offset += PAGE;
      }

      if (cancelled) return;
      const out: NetFlowsByAddress = {};
      for (const [addr, net] of Object.entries(acc)) out[addr] = net.toString();
      setFlows(out);
    })().catch(() => {
      if (!cancelled) setFlows({});
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, userAddress]);

  return flows;
};
