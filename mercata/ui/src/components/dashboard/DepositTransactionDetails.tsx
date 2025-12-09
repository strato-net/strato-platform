import { useEffect, useState } from "react";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Table, Select, Space, Card } from "antd";
import { FrownOutlined, CopyOutlined } from "@ant-design/icons";
import { useBridgeContext } from "@/context/BridgeContext";
import { formatDate, getChainName, BRIDGE_STATUS_OPTIONS, handleCopyToClipboard, getExplorerUrl } from "@/lib/bridge/utils";
import { renderTruncatedAddressWithCopy } from "@/lib/bridge/components";
import { DepositTransaction } from "@/lib/bridge/types";
import { ITEMS_PER_PAGE } from "@/lib/bridge/constants";
import { formatWeiToDecimalHP } from "@/utils/numberUtils";
import { ensureHexPrefix } from "@/utils/numberUtils";
import { usdstAddress } from "@/lib/constants";
import { useIsMobile } from "@/hooks/use-mobile";

const DepositTransactionDetails = ({ context }: { context?: string }) => {
  const isMobile = useIsMobile();
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [depositStatus, setDepositStatus] = useState<number>(0);
  const [selectedChainId, setSelectedChainId] = useState<number>(0);
  const [selectedType, setSelectedType] = useState<'bridge' | 'convert' | ''>('');
  const [transactions, setTransactions] = useState<DepositTransaction[]>([]);
  const DEPOSIT_STATUS_OPTIONS = BRIDGE_STATUS_OPTIONS.filter((o) => o.value !== 4);

  const {
    loading: isLoading,
    fetchDepositTransactions,
    availableNetworks,
  } = useBridgeContext();

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        const params: Record<string, string> = {
          limit: ITEMS_PER_PAGE.toString(),
          offset: ((currentPage - 1) * ITEMS_PER_PAGE).toString(),
          order: 'block_timestamp.desc',
        };
        
        if (selectedType === 'convert') {
          (params as any)["value->>stratoToken"] = `eq.${usdstAddress}`;
        } else if (selectedType === 'bridge') {
          (params as any)["value->>stratoToken"] = `neq.${usdstAddress}`;
        }
        
        if (depositStatus !== 0) {
          (params as any)["value->>bridgeStatus"] = `eq.${depositStatus}`;
        }
        
        if (selectedChainId !== 0) {
          (params as any)["key"] = `eq.${selectedChainId}`;
        }
        
        const result = await fetchDepositTransactions(params, context);
        setTransactions(result.data);
        setTotalCount(result.totalCount);
      } catch (error) {
        console.error("Error loading transactions:", error);
        setTransactions([]);
        setTotalCount(0);
      }
    };

    loadTransactions();
  }, [currentPage, depositStatus, selectedChainId, fetchDepositTransactions, context, selectedType]);

  

  const columns = [
    {
      title: "From",
      key: "from",
      render: (_: any, record: any) => {
        const chainName = record.externalChainId ? getChainName(record.externalChainId) : "Unknown Chain";
        const addr = ensureHexPrefix(record?.DepositInfo?.externalSender) || "";
        const chainIdStr = record?.externalChainId ? String(record.externalChainId) : '1';
        const txUrl = getExplorerUrl(chainIdStr, '0x');
        const base = txUrl.split('/tx/')[0];
        const addressUrl = addr ? `${base}/address/${addr}` : '';
        return (
          <div>
            <div className="text-xs text-muted-foreground mb-1">{chainName}</div>
            {addr ? (
              <div className="group relative flex items-center gap-2">
                <a
                  href={addressUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800"
                >
                  {`${addr.slice(0, 6)}...${addr.slice(-4)}`}
                </a>
                <CopyOutlined
                  className="text-muted-foreground hover:text-blue-500 cursor-pointer transition-colors"
                  onClick={() => handleCopyToClipboard(addr)}
                />
              </div>
            ) : '-'}
          </div>
        );
      },
      width: 120,
    },
    {
      title: "To (STRATO)",
      key: "to",
      render: (_: any, record: any) =>
        renderTruncatedAddressWithCopy(
          ensureHexPrefix(record?.DepositInfo?.stratoRecipient) || "",
          handleCopyToClipboard
        ),
      width: 100,
    },
    {
      title: "Token",
      key: "ethTokenSymbol",
      render: (_: any, record: any) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-foreground">{
            record.externalSymbol ||
            (record.externalName === 'Ether' ? 'ETH' : record.externalName) ||
            '-'
          }</span>
        </div>
      ),
      width: 150,
    },
    {
      title: "Token (STRATO)",
      key: "token",
      render: (_: any, record: any) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-foreground">{record.stratoTokenSymbol || '-'}</span>
        </div>
      ),
      width: 150,
    },
    {
      title: "Amount",
      key: "amount",
      render: (_: any, record: any) =>
        formatWeiToDecimalHP(record?.DepositInfo?.stratoTokenAmount || '0', 18),
      width: 80,
    },
    {
      title: "Status",
      key: "depositStatus",
      render: (_: any, record: any) => {
        const statusStr = record?.DepositInfo?.bridgeStatus || "0";
        const statusNum = parseInt(statusStr);
        if (statusNum === 1) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              <Clock className="h-3 w-3 mr-1" />
              Initiated
            </span>
          );
        } else if (statusNum === 2) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Pending Review
            </span>
          );
        } else if (statusNum === 3) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Completed
            </span>
          );
        }
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
            <AlertCircle className="h-3 w-3 mr-1" />
            Unknown
          </span>
        );
      },
      width: 80,
    },
    {
      title: "Time",
      dataIndex: "block_timestamp",
      key: "block_timestamp",
      render: (text: string) => formatDate(text),
      width: 200,
    },
  ];

  return (
    <div className="space-y-4 deposit-history-table">
      <style>{`
        .deposit-history-table .ant-table {
          background: transparent !important;
          color: inherit !important;
        }
        .deposit-history-table .ant-table-thead > tr > th {
          background: hsl(var(--muted) / 0.5) !important;
          color: hsl(var(--muted-foreground)) !important;
          border-bottom: 1px solid hsl(var(--border)) !important;
        }
        .deposit-history-table .ant-table-tbody > tr > td {
          border-bottom: 1px solid hsl(var(--border)) !important;
          color: hsl(var(--foreground)) !important;
        }
        .deposit-history-table .ant-table-tbody > tr:hover > td {
          background: hsl(var(--muted) / 0.5) !important;
        }
        .deposit-history-table .ant-pagination {
            color: hsl(var(--foreground)) !important;
            display: flex !important;
            justify-content: center !important;
        }
        .deposit-history-table .ant-pagination-item {
            background: transparent !important;
        }
        .deposit-history-table .ant-pagination-item:hover {
            background: transparent !important;
        }
        .deposit-history-table .ant-pagination-item a {
            color: hsl(var(--foreground)) !important;
        }
        .deposit-history-table .ant-pagination-item-active {
            background: transparent !important;
            border-color: hsl(var(--primary)) !important;
        }
        .deposit-history-table .ant-pagination-item-active a {
            color: hsl(var(--primary)) !important;
        }
        .deposit-history-table .ant-pagination-prev .ant-pagination-item-link,
        .deposit-history-table .ant-pagination-next .ant-pagination-item-link {
            color: hsl(var(--foreground)) !important;
            background: transparent !important;
        }
        .deposit-history-table .ant-select-selector {
            background-color: hsl(var(--background)) !important;
            border-color: hsl(var(--border)) !important;
            color: hsl(var(--foreground)) !important;
        }
        .deposit-history-table .ant-select-arrow {
            color: hsl(var(--muted-foreground)) !important;
        }
        /* We need global override for dropdown as it renders in portal */
        .ant-select-dropdown {
            background-color: hsl(var(--popover)) !important;
            border: 1px solid hsl(var(--border)) !important;
        }
        .ant-select-item {
            color: hsl(var(--foreground)) !important;
        }
        .ant-select-item-option-selected {
            background-color: hsl(var(--accent)) !important;
            color: hsl(var(--accent-foreground)) !important;
        }
        .ant-select-item-option-active {
            background-color: hsl(var(--accent) / 0.5) !important;
        }
        .deposit-history-table .ant-table-placeholder {
            background: transparent !important;
        }
        .deposit-history-table .ant-table-placeholder .ant-empty-description {
            color: hsl(var(--muted-foreground)) !important;
        }
      `}</style>
      <Card className="bg-card rounded-xl shadow-sm border border-border">
        <Space 
          size="large" 
          direction={isMobile ? "vertical" : "horizontal"} 
          className={isMobile ? "w-full" : ""}
          style={isMobile ? { width: '100%' } : {}}
        >
          <div className={isMobile ? "w-full" : ""}>
            <label className="block text-sm font-medium text-foreground mb-1">
              Type
            </label>
            <Select
              value={selectedType || ''}
              onChange={(v) => {
                setSelectedType(v === '' ? '' : v as 'bridge' | 'convert');
                setCurrentPage(1);
              }}
              style={{ width: isMobile ? '100%' : 150 }}
              options={[
                { value: '', label: 'All Types' },
                { value: 'bridge', label: 'Bridge' },
                { value: 'convert', label: 'Convert' },
              ]}
            />
          </div>
          <div className={isMobile ? "w-full" : ""}>
            <label className="block text-sm font-medium text-foreground mb-1">
              Status Filter
            </label>
            <Select
              value={depositStatus || 0}
              onChange={(v) => {
                setDepositStatus(v || 0);
                setCurrentPage(1);
              }}
              style={{ width: isMobile ? '100%' : 150 }}
              options={DEPOSIT_STATUS_OPTIONS}
            />
          </div>
          <div className={isMobile ? "w-full" : ""}>
            <label className="block text-sm font-medium text-foreground mb-1">
              Chain Filter
            </label>
            <Select
              value={selectedChainId || 0}
              onChange={(v) => {
                setSelectedChainId(v || 0);
                setCurrentPage(1);
              }}
              style={{ width: isMobile ? '100%' : 150 }}
              options={[
                  { value: 0, label: "All Chains" },
                ...availableNetworks.map((n) => ({ value: parseInt(n.chainId), label: n.chainName }))
              ]}
            />
          </div>
        </Space>
      </Card>
      
      <div className="bg-card rounded-xl shadow-sm border border-border overflow-x-auto">
        <Table
          columns={columns}
          dataSource={transactions}
          loading={isLoading}
          scroll={isMobile ? { x: 'max-content' } : undefined}
          pagination={{
            current: currentPage,
            total: totalCount,
            pageSize: ITEMS_PER_PAGE,
            onChange: (page) => setCurrentPage(page),
            showSizeChanger: false,
            showTotal: (total, range) =>
              `${range[0]}-${range[1]} of ${total} items`,
            simple: isMobile,
          }}
          locale={{
            emptyText: (
              <div className="py-12 text-center text-muted-foreground">
                <div className="flex flex-col items-center justify-center gap-2">
                  <FrownOutlined style={{ fontSize: 48, color: "currentColor" }} />
                  <span className="text-lg font-semibold text-muted-foreground">
                    Sorry, no data found
                  </span>
                </div>
              </div>
            ),
          }}
          rowKey={(_, index) => index}
        />
      </div>
    </div>
  );
};

export default DepositTransactionDetails;
