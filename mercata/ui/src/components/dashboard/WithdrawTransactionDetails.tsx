import { useEffect, useState } from 'react';
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Table, Select, Space, Card } from 'antd';
import { CopyOutlined, FrownOutlined } from '@ant-design/icons';
import { useBridgeContext } from '@/context/BridgeContext';
import { formatDate, getChainName, BRIDGE_STATUS_OPTIONS, CHAIN_OPTIONS, handleCopyToClipboard } from '@/lib/bridge/utils';
import { renderTruncatedAddressWithCopy } from '@/lib/bridge/components';
import { ITEMS_PER_PAGE } from '@/lib/bridge/constants';
import { formatWeiToDecimalHP } from '@/utils/numberUtils';
import { ensureHexPrefix } from '@/utils/numberUtils';
import { usdstAddress } from '@/lib/constants';

const WithdrawTransactionDetails = ({ mintUSDST = false, showAll = false }: { mintUSDST?: boolean; showAll?: boolean }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [withdrawalStatus, setWithdrawalStatus] = useState<number | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<number | string | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);

  const {
    loading: isLoading,
    fetchWithdrawTransactions,
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
        
        // Only filter by stratoToken if showAll is false
        // If showAll is true, show all withdrawals regardless of token type
        if (!showAll) {
          (params as any)["value->>stratoToken"] = mintUSDST ? `eq.${usdstAddress}` : `neq.${usdstAddress}`;
        }
        
        if (withdrawalStatus !== null) {
          (params as any)["value->>bridgeStatus"] = `eq.${withdrawalStatus}`;
        }
        
        if (selectedChainId !== null && selectedChainId !== 'all') {
          (params as any)["value->>externalChainId"] = `eq.${selectedChainId}`;
        }
        
        const result = await fetchWithdrawTransactions(params);
        setTransactions(result.data);
        setTotalCount(result.totalCount);
      } catch (error) {
        console.error('Error loading transactions:', error);
        setTransactions([]);
        setTotalCount(0);
      }
    };

    loadTransactions();
  }, [currentPage, withdrawalStatus, selectedChainId, fetchWithdrawTransactions, mintUSDST, showAll]);

  const columns = [
    {
      title: 'Date',
      dataIndex: 'block_timestamp',
      key: 'date',
      render: (text: string) => formatDate(text),
      width: 150,
    },
    {
      title: 'Asset',
      key: 'asset',
      render: (_: any, record: any) => {
        // Show external symbol if available, otherwise show STRATO token symbol
        const symbol =
          record?.externalSymbol ||
          (record?.externalName === 'Ether' ? 'ETH' : record?.externalName) ||
          record?.stratoTokenSymbol ||
          (mintUSDST ? 'USDST' : '-');
        return <span className="text-sm text-gray-700">{symbol}</span>;
      },
      width: 120,
    },
    {
      title: 'Amount',
      key: 'amount',
      render: (_: any, record: any) => formatWeiToDecimalHP(record?.WithdrawalInfo?.stratoTokenAmount || '0', 18),
      width: 120,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: any, record: any) => {
        const statusStr = record?.WithdrawalInfo?.bridgeStatus || '0';
        const statusNum = parseInt(statusStr);
        if (statusNum === 1) {
          // Initiated = Pending (orange)
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
              <Clock className="h-3 w-3 mr-1" />
              Pending
            </span>
          );
        } else if (statusNum === 2) {
          // Pending Review = Pending (orange)
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Pending
            </span>
          );
        } else if (statusNum === 3) {
          // Completed = Completed (green)
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Completed
            </span>
          );
        } else if (statusNum === 4) {
          // Aborted = Failed (red)
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Failed
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
      width: 120,
    },
    {
      title: 'Transaction',
      key: 'transaction',
      render: (_: any, record: any) => {
        // Use block_hash as transaction identifier (transaction_hash not available in withdrawal records)
        // block_hash points to the block where the withdrawal was created
        const blockHash = record?.block_hash || record?.transaction_hash || '';
        if (!blockHash) return '-';
        
        // Remove 0x prefix if present for stratoscan URL (stratoscan doesn't use 0x prefix)
        const hashWithoutPrefix = blockHash.startsWith('0x') ? blockHash.slice(2) : blockHash;
        
        // Link to stratoscan transaction page
        const stratoscanUrl = `https://stratoscan.stratomercata.com/tx/${hashWithoutPrefix}`;
        const hashForDisplay = blockHash.startsWith('0x') ? blockHash : `0x${blockHash}`;
        const shortenedHash = hashForDisplay.length > 10 ? `${hashForDisplay.slice(0, 8)}...${hashForDisplay.slice(-6)}` : hashForDisplay;
        
        return (
          <a
            href={stratoscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800"
          >
            {shortenedHash}
          </a>
        );
      },
      width: 150,
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
              value={withdrawalStatus}
              onChange={(v) => {
                setWithdrawalStatus(v);
                setCurrentPage(1);
              }}
              style={{ width: 150 }}
              options={BRIDGE_STATUS_OPTIONS}
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
                { value: 'all', label: 'All Chains' },
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
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items`,
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
          rowKey={(record) => {
            // Create unique key from record properties
            const sender = record?.WithdrawalInfo?.stratoSender || '';
            const recipient = record?.WithdrawalInfo?.externalRecipient || '';
            const timestamp = record?.block_timestamp || '';
            const amount = record?.WithdrawalInfo?.stratoTokenAmount || '';
            return `${sender}-${recipient}-${timestamp}-${amount}`;
          }}
        />
      </div>
    </div>
  );
};

export default WithdrawTransactionDetails; 