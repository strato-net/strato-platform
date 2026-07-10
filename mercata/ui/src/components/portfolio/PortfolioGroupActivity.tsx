import { useMemo } from "react";
import { formatUnits } from "viem";
import { format } from "date-fns";
import type { Event } from "@mercata/shared-types";
import { eventTokenAddresses } from "@/hooks/useMyActivityEvents";

interface Props {
  /** Normalized (lowercased, 0x-stripped) token addresses in this group. */
  addresses: string[];
  events: Event[];
  loading: boolean;
  /** Max rows to show. */
  limit?: number;
  /** Hide the internal "Transaction History" heading + top divider. */
  hideHeader?: boolean;
}

const fmtAmount = (raw?: string): string => {
  if (!raw || raw === "0") return "";
  try {
    const n = parseFloat(formatUnits(BigInt(raw), 18));
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  } catch {
    return "";
  }
};

const fmtDate = (ts?: string): string => {
  if (!ts) return "";
  try {
    return format(new Date(ts), "MMM d, yyyy h:mm a");
  } catch {
    return ts;
  }
};

/**
 * Recent transaction history scoped to the asset the user is viewing — i.e. the
 * events (from the shared myActivity fetch) that involve any of this group's
 * token addresses.
 */
const PortfolioGroupActivity = ({ addresses, events, loading, limit = 8, hideHeader }: Props) => {
  const rows = useMemo(() => {
    if (!addresses.length) return [];
    const set = new Set(addresses);
    return events
      .filter((e) => eventTokenAddresses(e).some((a) => set.has(a)))
      .slice(0, limit);
  }, [addresses, events, limit]);

  return (
    <div className={hideHeader ? "" : "mt-2 border-t border-border pt-3"}>
      {!hideHeader && (
        <div className="px-2 text-xs font-medium text-muted-foreground mb-1">
          Transaction History
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="px-2 py-3 text-xs text-muted-foreground">Loading activity…</div>
      ) : rows.length === 0 ? (
        <div className="px-2 py-3 text-xs text-muted-foreground">No transactions for this asset.</div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((e) => {
            const amount = fmtAmount(e.attributes?.value || e.attributes?.amount);
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 px-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{e.event_name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {e.contract_name} · {fmtDate(e.block_timestamp)}
                  </div>
                </div>
                {amount && (
                  <div className="text-sm tabular-nums text-foreground shrink-0">{amount}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default PortfolioGroupActivity;
