import { useEffect, useState } from "react";
import type { Event } from "@mercata/shared-types";
import { activityFeedApi } from "@/lib/activityFeed";
import { activityTypes } from "@/components/dashboard/activityTypes";

const norm = (v?: string | null): string =>
  (v || "").toLowerCase().replace(/^0x/, "");

const ALL_PAIRS = Object.values(activityTypes).map((c) => ({
  contract_name: c.contract_name,
  event_name: c.event_name,
}));

const CONFIG_BY_KEY = new Map(
  Object.values(activityTypes).map((c) => [`${c.contract_name}:${c.event_name}`, c])
);

/**
 * Token address(es) an event involves, using each activity type's
 * `getTokenAddress` extractor (falling back to the emitting contract address for
 * Token Transfers). Returned normalized (lowercased, 0x-stripped).
 */
export const eventTokenAddresses = (e: Event): string[] => {
  const cfg = CONFIG_BY_KEY.get(`${e.contract_name}:${e.event_name}`);
  const addrs = cfg?.getTokenAddress ? cfg.getTokenAddress(e) : [e.address];
  return (addrs || []).filter(Boolean).map(norm);
};

const PAGE = 200;
const MAX_PAGES = 10;

/**
 * Fetch the logged-in user's activity once (all activity types, `myActivity`).
 * Consumers filter client-side per asset via `eventTokenAddresses`. Returns an
 * empty list until resolved or when disabled.
 */
export const useMyActivityEvents = (enabled: boolean): { events: Event[]; loading: boolean } => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      const all: Event[] = [];
      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await activityFeedApi.getActivities(ALL_PAIRS, {
          myActivity: true,
          limit: PAGE,
          offset,
        });
        const evs = res.events || [];
        all.push(...evs);
        if (evs.length < PAGE) break;
        offset += PAGE;
      }
      if (!cancelled) setEvents(all);
    })()
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { events, loading };
};
