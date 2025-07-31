import { useEffect, useState } from 'react';
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import message from 'antd/es/message';
import Table from 'antd/es/table';
import CopyOutlined from '@ant-design/icons/CopyOutlined';
import FrownOutlined from '@ant-design/icons/FrownOutlined';
import { useTransactionContext } from '@/context/TransactionContext';

interface WithdrawTransaction {
  transaction_hash: string;
  block_timestamp: string;
  from: string;
  to: string;
  amount: string;
  txHash?: string;
  token?: string;
  key?: string;
  withdrawalStatus?: string;
  tokenSymbol?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
}

const ITEMS_PER_PAGE = 10;

const WithdrawTransactionDetails = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [withdrawalStatus, setWithdrawalStatus] = useState('WithdrawalInitiated');
  const [transactions, setTransactions] = useState<WithdrawTransaction[]>([]);

  const {
    loading: isLoading,
    fetchWithdrawTransactions,
    formatDate,
    copyToClipboard,
    renderTruncatedAddress
  } = useTransactionContext();

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        const result = await fetchWithdrawTransactions({
          status: withdrawalStatus,
          page: currentPage,
          limit: ITEMS_PER_PAGE
        });
        setTransactions(result.data);
        setTotalCount(result.totalCount);
      } catch (error) {
        console.error('Error loading transactions:', error);
        setTransactions([]);
        setTotalCount(0);
      }
    };

    loadTransactions();
  }, [currentPage, withdrawalStatus, fetchWithdrawTransactions]);

  const handleCopyToClipboard = async (text: string) => {
    try {
      await copyToClipboard(text);
      message.success('Copied to clipboard');
    } catch (error) {
      message.error('Failed to copy');
    }
  };

  const renderTruncatedAddressWithCopy = (address: string) => {
    if (!address) return '-';
    return (
      <div className="group relative flex items-center gap-2">
        <span className="cursor-pointer">
          {renderTruncatedAddress(address)}
        </span>
        <CopyOutlined 
          className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors" 
          onClick={() => handleCopyToClipboard(address)}
        />
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
          {address}
        </div>
      </div>
    );
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalCount);

  const columns = [
    {
      title: 'From (STRATO)',
      dataIndex: 'from',
      key: 'from',
      render: (text: string) => renderTruncatedAddressWithCopy(text),
      width: 100,
    },
    {
      title: 'To (ETH)',
      dataIndex: 'to',
      key: 'to',
      render: (text: string) => renderTruncatedAddressWithCopy(text),
      width: 100,
    },
    {
      title: 'Token (ETH)',
      dataIndex: 'ethTokenSymbol',
      key: 'ethTokenSymbol',
      render: (text: string, record: WithdrawTransaction) => (
        <div className="flex flex-col gap-1">
          <span>{text || '-'}</span>
          {record.ethTokenAddress && (
            <span className="text-xs text-gray-500">
              {renderTruncatedAddressWithCopy(record.ethTokenAddress)}
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
          <span>{text || '-'}</span>
          {record.token && (
            <span className="text-xs text-gray-500">
              {renderTruncatedAddressWithCopy(record.token)}
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
      render: (text: string) => renderTruncatedAddressWithCopy(text),
      width: 100,
    },
    {
      title: 'Status',
      dataIndex: 'withdrawalStatus',
      key: 'withdrawalStatus',
      render: (status: string) => {
        if (status === "1") {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              <Clock className="h-3 w-3 mr-1" />
              Initiated
            </span>
          );
        } else if (status === "2") {
          return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Approval Pending
            </span>
          );
        } else if (status === "3") {
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
      title: 'Time',
      dataIndex: 'block_timestamp',
      key: 'block_timestamp',
      render: (text: string) => formatDate(text),
      width: 200,
    },
  ];

  return (
    <div className="space-y-4">
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