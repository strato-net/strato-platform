import { Link } from "react-router-dom";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSocketRoom } from "@/hooks/useSocketRoom";
import { ROOMS } from "@/lib/socket";
import { shortenHex } from "@/lib/utils";

interface RecentTx {
  hash?: string;
  transactionType?: string;
  // apex-ws emits the raw transaction row, where the function is `func_name`.
  func_name?: string;
  from_address?: string;
  to_address?: string;
}

/** The called function name (matching the "Transactions by Function" pie), falling
 * back to the transaction type for non-function txs (transfers/deploys). */
function txLabel(t: RecentTx): string {
  return t.func_name?.trim() || t.transactionType || "—";
}

export function RecentTransactionsCard() {
  const txns = useSocketRoom<RecentTx[]>(ROOMS.GET_TRANSACTIONS, []);
  const recent = (txns || []).slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" /> Recent Transactions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent transactions.</p>
        ) : (
          <ScrollArea className="h-48 pr-2">
            <ul className="space-y-1">
              {recent.map((t, i) => (
                <li key={`${t.hash}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  {t.hash ? (
                    <Link to={`/explorer/transactions/${t.hash}`} className="font-mono text-xs text-primary hover:underline">
                      {shortenHex(t.hash)}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">—</span>
                  )}
                  <Badge variant="outline" className="shrink-0 font-mono">{txLabel(t)}</Badge>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
