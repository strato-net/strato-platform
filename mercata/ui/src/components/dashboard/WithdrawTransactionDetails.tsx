import { useEffect, useState } from 'react';
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Table, Select, Space, Card } from 'antd';
import { CopyOutlined, FrownOutlined } from '@ant-design/icons';
import { useBridgeContext } from '@/context/BridgeContext';
import { formatTxHash, formatDate, getChainName, BRIDGE_STATUS_OPTIONS, CHAIN_OPTIONS, handleCopyToClipboard } from '@/lib/bridge/utils';
import { renderTruncatedAddressWithCopy } from '@/lib/bridge/components';
import { WithdrawTransaction } from '@/lib/bridge/types';
import { ITEMS_PER_PAGE } from '@/lib/bridge/constants';

const WithdrawTransactionDetails = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [withdrawalStatus, setWithdrawalStatus] = useState<number | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WithdrawTransaction[]>([]);

  const {
    loading: isLoading,
    fetchWithdrawTransactions,
  } = useBridgeContext();

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        const params: Record<string, string> = {
          limit: ITEMS_PER_PAGE.toString(),
          offset: ((currentPage - 1) * ITEMS_PER_PAGE).toString(),
          order: 'block_timestamp.desc',
        };
        
        if (withdrawalStatus !== null) {
          params.status = `eq.${withdrawalStatus}`;
        }
        
        if (selectedChainId !== null) {
          params.destChainId = `eq.${selectedChainId}`;
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
  }, [currentPage, withdrawalStatus, selectedChainId, fetchWithdrawTransactions]);

  const columns = [
    {
      title: 'From (STRATO)',
      dataIndex: 'from',
      key: 'from',
      render: (text: string) => renderTruncatedAddressWithCopy(text, handleCopyToClipboard),
      width: 100,
    },
    {
      title: "To",
      dataIndex: 'to',
      key: 'to',
      render: (text: string, record: WithdrawTransaction) => (
        <div>
          <div className="text-xs text-gray-500 mb-1">
            {record.destChainId ? getChainName(record.destChainId) : "Unknown Chain"}
          </div>
          {renderTruncatedAddressWithCopy(text, handleCopyToClipboard)}
        </div>
      ),
      width: 120,
    },
    {
      title: "Token (External)",
      dataIndex: 'ethTokenSymbol',
      key: 'ethTokenSymbol',
      render: (text: string, record: WithdrawTransaction) => (
        <div className="flex flex-col gap-1">
          <div className="text-xs text-gray-500 mb-1">
            {record.destChainId ? getChainName(record.destChainId) : "Unknown Chain"}
          </div>
          {record.ethTokenAddress && (
            <span className="text-xs text-gray-500">
              {renderTruncatedAddressWithCopy(record.ethTokenAddress, handleCopyToClipboard)}
            </span>
          )}
        </div>
      ),
      width: 150,
    },
    {
      title: 'Token (STRATO)',
      dataIndex: 'tokenSymbol',
      key: 'tokenSymbol',
      render: (text: string, record: WithdrawTransaction) => (
        <div className="flex flex-col gap-1">
          {/* <span>{text || '-'}</span> */}
          {record.token && (
            <span className="text-xs text-gray-500">
              {renderTruncatedAddressWithCopy(record.token, handleCopyToClipboard)}
            </span>
          )}
        </div>
      ),
      width: 150,
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      width: 80,
    },
    {
      title: 'Tx Hash',
      dataIndex: 'txHash',
      key: 'txHash',
      render: (text: string) => text ? (
        <div className="group relative flex items-center gap-2">
          <span className="cursor-pointer">
            {formatTxHash(text)}
          </span>
          <CopyOutlined
            className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
            onClick={() => handleCopyToClipboard(text)}
          />
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
            {text}
          </div>
        </div>
      ) : "-",
      width: 100,
    },
    {
      title: 'Status',
      dataIndex: 'withdrawalStatus',
      key: 'withdrawalStatus',
      render: (status: string) => {
        const statusNum = parseInt(status);
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
              Completed
            </span>
          );
        } else if (statusNum === 4) {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Aborted
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
      title: 'Time',
      dataIndex: 'block_timestamp',
      key: 'block_timestamp',
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
              value={withdrawalStatus}
              onChange={setWithdrawalStatus}
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
              onChange={setSelectedChainId}
              style={{ width: 150 }}
              options={CHAIN_OPTIONS}
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
          rowKey={(record) => record.transaction_hash}
        />
      </div>
    </div>
  );
};

export default WithdrawTransactionDetails; 