import { useEffect, useState } from "react";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Table, Select, Space, Card } from "antd";
import { FrownOutlined, CopyOutlined } from "@ant-design/icons";
import { useBridgeContext } from "@/context/BridgeContext";
import { formatDate, getChainName, BRIDGE_STATUS_OPTIONS, handleCopyToClipboard, getExplorerUrl, mergePendingDeposits } from "@/lib/bridge/utils";
import { renderTruncatedAddressWithCopy } from "@/lib/bridge/components";
import { DepositTransaction } from "@/lib/bridge/types";
import { ITEMS_PER_PAGE } from "@/lib/bridge/constants";
import { formatWeiToDecimalHP } from "@/utils/numberUtils";
import { ensureHexPrefix } from "@/utils/numberUtils";

import { useIsMobile } from "@/hooks/use-mobile";

const DepositTransactionDetails = ({ context }: { context?: string }) => {
  const isMobile = useIsMobile();
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [depositStatus, setDepositStatus] = useState<number>(0);
  const [selectedChainId, setSelectedChainId] = useState<number>(0);
  const [selectedType, setSelectedType] = useState<'bridge' | 'save' | 'forge' | ''>('');
  const [transactions, setTransactions] = useState<DepositTransaction[]>([]);
  const DEPOSIT_STATUS_OPTIONS = BRIDGE_STATUS_OPTIONS.filter((o) => o.value !== 4);

  const {
    loading: isLoading,
    fetchDepositTransactions,
    availableNetworks,
    depositRefreshKey,
  } = useBridgeContext();

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        const params: Record<string, string> = {
          limit: ITEMS_PER_PAGE.toString(),
          offset: ((currentPage - 1) * ITEMS_PER_PAGE).toString(),
          order: 'block_timestamp.desc',
        };
        
        if (depositStatus !== 0) {
          (params as any)["value->>bridgeStatus"] = `eq.${depositStatus}`;
        }
        
        if (selectedChainId !== 0) {
          (params as any)["key"] = `eq.${selectedChainId}`;
        }
        
        const result = await fetchDepositTransactions(params, context);
        const apiTransactions = result.data;
        
        const { remaining: remainingPending } = mergePendingDeposits(apiTransactions as any[]);
        
        const typeFilter = (outcome: string | undefined, pendingType?: string) => {
          if (!selectedType) return true;
          const mapped = pendingType === 'saving' ? 'save' : pendingType || outcome || 'bridge';
          return mapped === selectedType;
        };

        const filteredPending = remainingPending.filter((p: any) => {
          if (!typeFilter(undefined, p?.type)) return false;
          if (depositStatus !== 0 && parseInt(p?.DepositInfo?.bridgeStatus || '0') !== depositStatus) return false;
          if (selectedChainId !== 0 && p?.externalChainId !== selectedChainId) return false;
          return true;
        });

        const filteredApi = selectedType ? apiTransactions.filter((tx: any) => typeFilter(tx.depositOutcome)) : apiTransactions;
        const merged = currentPage === 1 ? [...filteredPending, ...filteredApi] : filteredApi;
        setTransactions(merged as DepositTransaction[]);
        setTotalCount(result.totalCount + filteredPending.length);
      } catch (error) {
        console.error("Error loading transactions:", error);
        setTransactions([]);
        setTotalCount(0);
      }
    };

    loadTransactions();
  }, [currentPage, depositStatus, selectedChainId, fetchDepositTransactions, context, selectedType, depositRefreshKey]);

  

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
      title: "Sent",
      key: "sent",
      render: (_: any, record: any) => {
        const symbol = record.externalSymbol || (record.externalName === 'Ether' ? 'ETH' : record.externalName) || '-';
        const amount = formatWeiToDecimalHP(record?.DepositInfo?.stratoTokenAmount || '0', 18);
        return <span className="text-sm text-foreground">{amount} {symbol}</span>;
      },
      width: 140,
    },
    {
      title: "Received",
      key: "received",
      render: (_: any, record: any) => {
        const outcome = record.depositOutcome;
        const hasFinal = (outcome === "forge" || outcome === "save") && record.finalTokenSymbol;
        const symbol = hasFinal ? record.finalTokenSymbol : record.stratoTokenSymbol || '-';
        const amount = hasFinal && record.finalAmount
          ? formatWeiToDecimalHP(record.finalAmount, 18)
          : formatWeiToDecimalHP(record?.DepositInfo?.stratoTokenAmount || '0', 18);
        const badge = outcome === "forge" ? "Metal" : outcome === "save" ? "Earn" : null;
        return (
          <div>
            <span className="text-sm text-foreground">{amount} {symbol}</span>
            {badge && <span className="text-[10px] text-muted-foreground ml-1.5">{badge}</span>}
          </div>
        );
      },
      width: 160,
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
    <div className="space-y-4 ant-table-themed">
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
                setSelectedType(v === '' ? '' : v as 'bridge' | 'save' | 'forge');
                setCurrentPage(1);
              }}
              style={{ width: isMobile ? '100%' : 150 }}
              options={[
                { value: '', label: 'All Types' },
                { value: 'bridge', label: 'Bridge' },
                { value: 'save', label: 'Earn' },
                { value: 'forge', label: 'Metal' },
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
