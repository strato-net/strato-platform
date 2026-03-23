import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Table } from "antd";
import { FrownOutlined } from "@ant-design/icons";
import { ITEMS_PER_PAGE } from "@/lib/bridge/constants";
import { formatDate } from "@/lib/bridge/utils";
import { formatWeiToDecimalHP } from "@/utils/numberUtils";
import { activityFeedApi } from "@/lib/activityFeed";
import { METAL_ACTIVITY_PAIR, MetalTx, resolveTokenSymbols, collectMetalTokenAddrs, mapEventsToMetalTxs } from "@/lib/metalActivity";
import { useIsMobile } from "@/hooks/use-mobile";

async function fetchMetalPage(page: number): Promise<{ txs: MetalTx[]; total: number }> {
  const result = await activityFeedApi.getActivities(
    METAL_ACTIVITY_PAIR,
    { limit: ITEMS_PER_PAGE, offset: (page - 1) * ITEMS_PER_PAGE, myActivity: true }
  );
  const events = result.events || [];
  const symbolMap = await resolveTokenSymbols([...collectMetalTokenAddrs(events)]);
  return { total: result.total || 0, txs: mapEventsToMetalTxs(events, symbolMap) };
}

const columns = [
  {
    title: "Paid", key: "paid", width: 180,
    render: (_: unknown, r: MetalTx) => (
      <span className="text-sm text-foreground">{formatWeiToDecimalHP(r.payAmount, 18)} {r.paySymbol}</span>
    ),
  },
  {
    title: "Received", key: "received", width: 180,
    render: (_: unknown, r: MetalTx) => (
      <span className="text-sm text-foreground">{formatWeiToDecimalHP(r.metalAmount, 18)} {r.metalSymbol}</span>
    ),
  },
  {
    title: "Status", key: "status", width: 120,
    render: () => (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Completed
      </span>
    ),
  },
  {
    title: "Time", dataIndex: "block_timestamp", key: "block_timestamp", width: 200,
    render: (text: string) => formatDate(text),
  },
];

const MetalTransactionDetails = () => {
  const isMobile = useIsMobile();
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [transactions, setTransactions] = useState<MetalTx[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const loadPage = async (page: number) => {
    setIsLoading(true);
    try {
      const { txs, total } = await fetchMetalPage(page);
      setTransactions(txs);
      setTotalCount(total);
    } catch {
      setTransactions([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  };

  if (!initialized) {
    setInitialized(true);
    loadPage(1);
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    loadPage(page);
  };

  return (
    <div className="bg-card rounded-xl shadow-sm border border-border overflow-x-auto ant-table-themed">
      <Table
        columns={columns}
        dataSource={transactions}
        loading={isLoading}
        scroll={isMobile ? { x: 'max-content' } : undefined}
        pagination={{
          current: currentPage,
          total: totalCount,
          pageSize: ITEMS_PER_PAGE,
          onChange: handlePageChange,
          showSizeChanger: false,
          showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items`,
          simple: isMobile,
        }}
        locale={{
          emptyText: (
            <div className="py-12 text-center text-muted-foreground">
              <div className="flex flex-col items-center justify-center gap-2">
                <FrownOutlined style={{ fontSize: 48, color: "currentColor" }} />
                <span className="text-lg font-semibold text-muted-foreground">No metal purchases found</span>
              </div>
            </div>
          ),
        }}
        rowKey={(_, index) => index}
      />
    </div>
  );
};

export default MetalTransactionDetails;
