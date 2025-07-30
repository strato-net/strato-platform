import React, { useEffect, useState, Suspense } from "react";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useTransactionContext } from "@/context/TransactionContext";
import { AntTable, AntLoadingFallback, CopyOutlined, LinkOutlined, FrownOutlined, IconLoadingFallback, getAntMessage } from "@/components/lazy/antd";

interface DepositTransaction {
  transaction_hash: string;
  block_timestamp: string;
  from: string;
  to: string;
  amount: string;
  txHash?: string;
  token?: string;
  key?: string;
  depositStatus?: string;
  tokenSymbol?: string;
  ethTokenName?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
}

const ITEMS_PER_PAGE = 10;

const DepositTransactionDetails = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [depositStatus, setDepositStatus] = useState("DepositInitiated");
  const [transactions, setTransactions] = useState<DepositTransaction[]>([]);

  const {
    loading: isLoading,
    fetchDepositTransactions,
    formatDate,
    copyToClipboard,
    renderTruncatedAddress,
    renderTransactionHash
  } = useTransactionContext();

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        const result = await fetchDepositTransactions({
          status: depositStatus,
          page: currentPage,
          limit: ITEMS_PER_PAGE
        });
        setTransactions(result.data);
        setTotalCount(result.totalCount);
      } catch (error) {
        console.error("Error loading transactions:", error);
        setTransactions([]);
        setTotalCount(0);
      }
    };

    loadTransactions();
  }, [currentPage, depositStatus, fetchDepositTransactions]);

  const handleCopyToClipboard = async (text: string) => {
    try {
      await copyToClipboard(text);
      const message = await getAntMessage();
      message.success("Copied to clipboard");
    } catch (error) {
      const message = await getAntMessage();
      message.error("Failed to copy");
    }
  };

  const renderTruncatedAddressWithCopy = (address: string) => {
    if (!address) return "-";
    return (
      <div className="group relative flex items-center gap-2">
        <span className="cursor-pointer">
          {renderTruncatedAddress(address)}
        </span>
        <Suspense fallback={<IconLoadingFallback />}>
          <CopyOutlined
            className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
            onClick={() => handleCopyToClipboard(address)}
          />
        </Suspense>
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
          {address}
        </div>
      </div>
    );
  };

  const renderTransactionHashWithLinks = (hash: string) => {
    if (!hash) return "-";
    const hashWithPrefix = hash.startsWith("0x") ? hash : `0x${hash}`;
    return (
      <div className="group relative flex items-center gap-2">
        <span className="cursor-pointer">
          {renderTransactionHash(hash)}
        </span>
        <Suspense fallback={<IconLoadingFallback />}>
          <CopyOutlined
            className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
            onClick={() => handleCopyToClipboard(hash)}
          />
          <LinkOutlined
            className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
            onClick={() => window.open(`https://etherscan.io/tx/${hashWithPrefix}`, '_blank')}
          />
        </Suspense>
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
          {hash}
        </div>
      </div>
    );
  };

  const columns = [
    {
      title: "From (ETH)",
      dataIndex: "from",
      key: "from",
      render: (text: string) => renderTruncatedAddressWithCopy(text),
      width: 100,
    },
    {
      title: "To (STRATO)",
      dataIndex: "to",
      key: "to",
      render: (text: string) => renderTruncatedAddressWithCopy(text),
      width: 100,
    },
    {
      title: "Token (ETH)",
      dataIndex: "ethTokenSymbol",
      key: "ethTokenSymbol",
      render: (text: string, record: DepositTransaction) => (
        <div className="flex flex-col gap-1">
          <span>{text || "-"}</span>
          {record.ethTokenAddress && (
            <span className="text-xs text-gray-500">
              {renderTruncatedAddress(record.ethTokenAddress)}
            </span>
          )}
        </div>
      ),
      width: 150,
    },
    {
      title: "Token (STRATO)",
      dataIndex: "tokenSymbol",
      key: "tokenSymbol",
      render: (text: string, record: DepositTransaction) => (
        <div className="flex flex-col gap-1">
          <span>{text || "-"}</span>
          {record.token && (
            <span className="text-xs text-gray-500">
              {renderTruncatedAddress(record.token)}
            </span>
          )}
        </div>
      ),
      width: 150,
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      width: 80,
    },
    {
      title: "Tx Hash",
      dataIndex: "txHash",
      key: "txHash",
      render: (text: string) => renderTransactionHashWithLinks(text),
      width: 100,
    },
    {
      title: "Status",
      dataIndex: "depositStatus",
      key: "depositStatus",
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
    <div className="bg-white/80 rounded-xl shadow-sm border border-gray-200">
      <Suspense fallback={<AntLoadingFallback />}>
        <AntTable
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
                  <Suspense fallback={<IconLoadingFallback />}>
                    <FrownOutlined style={{ fontSize: 48, color: "#bdbdbd" }} />
                  </Suspense>
                  <span className="text-lg font-semibold text-gray-400">
                    Sorry, no data found
                  </span>
                </div>
              </div>
            ),
          }}
          rowKey={(record: DepositTransaction) => record.transaction_hash}
        />
      </Suspense>
    </div>
  );
};

export default DepositTransactionDetails;
