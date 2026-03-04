import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/axios";
import { Loader2, Clock } from "lucide-react";

interface OnrampTransaction {
  externalTxHash: string;
  status: string;
  destinationCurrency?: string;
  destinationNetwork?: string;
  destinationAmount?: string;
  createdAt: string;
}

const STRATO_TOKEN: Record<string, string> = {
  eth: "ETHST",
  usdc: "USDST",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  fulfillment_processing: { label: "Processing", color: "text-blue-600" },
  fulfillment_complete: { label: "Complete", color: "text-green-600" },
  unknown: { label: "Unknown", color: "text-gray-500" },
};

const ITEMS_PER_PAGE = 8;

const PurchaseHistory = ({ refreshKey }: { refreshKey?: number }) => {
  const [page, setPage] = useState(1);
  const [transactions, setTransactions] = useState<OnrampTransaction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setFetching(true);
        const { data } = await api.get("/onramp/transactions", {
          params: {
            limit: String(ITEMS_PER_PAGE),
            offset: String((page - 1) * ITEMS_PER_PAGE),
          },
        });
        setTransactions(data.data.data || []);
        setTotalCount(data.data.totalCount || 0);
      } catch {
        // silently fail
      } finally {
        setInitialLoading(false);
        setFetching(false);
      }
    };
    load();
  }, [page, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Purchase History</CardTitle>
      </CardHeader>
      <CardContent>
        {initialLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : transactions.length === 0 && page === 1 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No purchases yet. Complete a purchase to see it here.
          </p>
        ) : (
          <>
            <div className={`overflow-x-auto transition-opacity duration-150 ${fetching ? "opacity-50" : "opacity-100"}`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Token</th>
                    <th className="pb-2 font-medium">Amount</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => {
                    const statusInfo = STATUS_LABELS[tx.status] || {
                      label: tx.status,
                      color: "text-gray-500",
                    };
                    return (
                      <tr key={tx.externalTxHash} className="border-b last:border-0">
                        <td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="py-3">
                          <span className="uppercase">{tx.destinationCurrency || "—"}</span>
                          {tx.destinationCurrency && STRATO_TOKEN[tx.destinationCurrency] && (
                            <span className="text-muted-foreground"> → {STRATO_TOKEN[tx.destinationCurrency]}</span>
                          )}
                        </td>
                        <td className="py-3" title={tx.destinationAmount || ""}>
                          {tx.destinationAmount
                            ? Number(tx.destinationAmount).toFixed(6)
                            : "—"}
                        </td>
                        <td className={`py-3 font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalCount > ITEMS_PER_PAGE && (
              <div className="flex items-center justify-between pt-3 border-t mt-2">
                <span className="text-xs text-muted-foreground">
                  {totalCount} purchase{totalCount !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || fetching}
                    className="px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <span className="text-xs text-muted-foreground px-2">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || fetching}
                    className="px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PurchaseHistory;
