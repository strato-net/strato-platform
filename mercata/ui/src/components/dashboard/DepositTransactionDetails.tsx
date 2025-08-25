import { useEffect, useState } from "react";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Table, Select, Space, Card } from "antd";
import { FrownOutlined, CopyOutlined } from "@ant-design/icons";
import { useBridgeContext } from "@/context/BridgeContext";
import { formatDate, getChainName, BRIDGE_STATUS_OPTIONS, handleCopyToClipboard, getExplorerUrl } from "@/lib/bridge/utils";
import { renderTruncatedAddressWithCopy } from "@/lib/bridge/components";
import { DepositTransaction } from "@/lib/bridge/types";
import { ITEMS_PER_PAGE } from "@/lib/bridge/constants";
import { formatWeiAmount } from "@/utils/numberUtils";
import { bridgeContractService } from "@/lib/bridge/contractService";

const DepositTransactionDetails = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [depositStatus, setDepositStatus] = useState<number | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
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
        
        if (depositStatus !== null) {
          (params as any)["value->>bridgeStatus"] = `eq.${depositStatus}`;
        }
        
        if (selectedChainId !== null) {
          (params as any)["key"] = `eq.${selectedChainId}`;
        }
        
        const result = await fetchDepositTransactions(params);
        setTransactions(result.data);
        setTotalCount(result.totalCount);
      } catch (error) {
        console.error("Error loading transactions:", error);
        setTransactions([]);
        setTotalCount(0);
      }
    };

    loadTransactions();
  }, [currentPage, depositStatus, selectedChainId, fetchDepositTransactions]);

  

  const columns = [
    {
      title: "From",
      key: "from",
      render: (_: any, record: any) => {
        const chainName = record.chainId ? getChainName(record.chainId) : "Unknown Chain";
        const addr = record?.depositInfo?.from
          ? bridgeContractService.formatAddress(record.depositInfo.from)
          : "";
        const chainIdStr = record?.chainId ? String(record.chainId) : '1';
        const txUrl = getExplorerUrl(chainIdStr, '0x');
        const base = txUrl.split('/tx/')[0];
        const addressUrl = addr ? `${base}/address/${addr}` : '';
        return (
          <div>
            <div className="text-xs text-gray-500 mb-1">{chainName}</div>
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
                  className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
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
          record?.depositInfo?.user
            ? bridgeContractService.formatAddress(record.depositInfo.user)
            : "",
          handleCopyToClipboard
        ),
      width: 100,
    },
    {
      title: "Token",
      key: "ethTokenSymbol",
      render: (_: any, record: any) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-gray-700">{
            record.extSymbol ||
            record.ethTokenSymbol ||
            (record.extName === 'Ether' ? 'ETH' : record.extName) ||
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
          <span className="text-sm text-gray-700">{record.tokenSymbol || record.stratoTokenSymbol || '-'}</span>
        </div>
      ),
      width: 150,
    },
    {
      title: "Amount",
      key: "amount",
      render: (_: any, record: any) =>
        formatWeiAmount(record?.depositInfo?.amount || '0'),
      width: 80,
    },
    {
      title: "Status",
      key: "depositStatus",
      render: (_: any, record: any) => {
        const statusStr = record?.depositStatus || record?.status || record?.depositInfo?.bridgeStatus || "0";
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
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
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
    <div className="space-y-4">
      <Card className="bg-white/80 rounded-xl shadow-sm border border-gray-200">
        <Space size="large">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status Filter
            </label>
            <Select
              value={depositStatus}
              onChange={(v) => {
                setDepositStatus(v);
                setCurrentPage(1);
              }}
              style={{ width: 150 }}
              options={DEPOSIT_STATUS_OPTIONS}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chain Filter
            </label>
            <Select
              value={selectedChainId}
              onChange={(v) => {
                setSelectedChainId(v);
                setCurrentPage(1);
              }}
              style={{ width: 150 }}
              options={[
                { value: null, label: "All Chains" },
                ...availableNetworks.map((n) => ({ value: parseInt(n.chainId), label: n.chainName }))
              ]}
            />
          </div>
        </Space>
      </Card>
      
      <div className="bg-white/80 rounded-xl shadow-sm border border-gray-200">
        <Table
          columns={columns}
          dataSource={transactions}
          loading={isLoading}
          pagination={{
            current: currentPage,
            total: totalCount,
            pageSize: ITEMS_PER_PAGE,
            onChange: (page) => setCurrentPage(page),
            showSizeChanger: false,
            showTotal: (total, range) =>
              `${range[0]}-${range[1]} of ${total} items`,
          }}
          locale={{
            emptyText: (
              <div className="py-12 text-center text-gray-500">
                <div className="flex flex-col items-center justify-center gap-2">
                  <FrownOutlined style={{ fontSize: 48, color: "#bdbdbd" }} />
                  <span className="text-lg font-semibold text-gray-400">
                    Sorry, no data found
                  </span>
                </div>
              </div>
            ),
          }}
          rowKey={(record, index) => `${record.transaction_hash}-${record.block_timestamp || ''}-${index}`}
        />
      </div>
    </div>
  );
};

export default DepositTransactionDetails;
