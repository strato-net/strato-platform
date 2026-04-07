import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/axios";
import { Loader2, Clock } from "lucide-react";

interface MeldTransaction {
  id: string;
  status: string;
  sourceAmount: number;
  sourceCurrencyCode: string;
  destinationAmount: number;
  destinationCurrencyCode: string;
  serviceProvider: string;
  createdAt: string;
  totalFee: number;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING_CREATED: { label: "Pending", color: "text-gray-500" },
  PENDING: { label: "Pending", color: "text-blue-600" },
  SETTLING: { label: "Processing", color: "text-blue-600" },
  SETTLED: { label: "Complete", color: "text-green-600" },
  FAILED: { label: "Failed", color: "text-red-600" },
  DECLINED: { label: "Declined", color: "text-red-600" },
  CANCELLED: { label: "Cancelled", color: "text-gray-500" },
  REFUNDED: { label: "Refunded", color: "text-orange-600" },
  ERROR: { label: "Error", color: "text-red-600" },
};

const STRATO_TOKEN: Record<string, string> = {
  ETH: "ETH",
  USDC: "USDST",
};

const ITEMS_PER_PAGE = 8;

const PurchaseHistoryV2 = ({ refreshKey }: { refreshKey?: number }) => {
  const [transactions, setTransactions] = useState<MeldTransaction[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setFetching(true);
        const { data } = await api.get("/onramp/v2/transactions", {
          params: { limit: String(ITEMS_PER_PAGE) },
        });
        setTransactions(data.data?.data || []);
      } catch {
        // silently fail
      } finally {
        setInitialLoading(false);
        setFetching(false);
      }
    };
    load();
  }, [refreshKey]);

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
        ) : transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No purchases yet. Complete a purchase to see it here.
          </p>
        ) : (
          <div className={`overflow-x-auto transition-opacity duration-150 ${fetching ? "opacity-50" : "opacity-100"}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Paid</th>
                  <th className="pb-2 font-medium">Received</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const statusInfo = STATUS_LABELS[tx.status] || {
                    label: tx.status,
                    color: "text-gray-500",
                  };
                  const stratoToken = STRATO_TOKEN[tx.destinationCurrencyCode] || tx.destinationCurrencyCode;
                  return (
                    <tr key={tx.id} className="border-b last:border-0">
                      <td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-3">
                        ${tx.sourceAmount} {tx.sourceCurrencyCode}
                      </td>
                      <td className="py-3">
                        {tx.destinationAmount
                          ? `${tx.destinationAmount} ${stratoToken}`
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
        )}
      </CardContent>
    </Card>
  );
};

export default PurchaseHistoryV2;
