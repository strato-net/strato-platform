import React, { useEffect, useState } from "react";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import axios from "axios";
import { Tooltip, message, Pagination } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { Button } from "@/components/ui/button";
import { FrownOutlined } from "@ant-design/icons";
import { formatDistanceToNow } from "date-fns";

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
}

const ITEMS_PER_PAGE = 10;

const formatDate = (dateString: string) => {
  try {
    const isoString = dateString.replace(" UTC", "Z");
    const date = new Date(isoString);
    const relativeTime = formatDistanceToNow(date, { addSuffix: true });
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    if (date < sevenDaysAgo) {
      const indianDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
      return indianDate.toLocaleString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    }

    return relativeTime;
  } catch (error) {
    console.error("Error formatting date:", error);
    return dateString;
  }
};

const DepositTransactionDetails = () => {
  const [transactions, setTransactions] = useState<DepositTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [depositStatus, setDepositStatus] = useState("DepositInitiated");

  useEffect(() => {
    const fetchDepositTransactions = async () => {
      setIsLoading(true);

      try {
        const response = await axios.get(
          `/api/depositStatus/${depositStatus}`,
          {
            params: {
              limit: ITEMS_PER_PAGE,
              pageNo: currentPage,
              orderBy: "block_timestamp",
              orderDirection: "desc",
            },
          }
        );

        const depositData = response.data?.data?.data.data || [];
        // console.log("depositData", depositData);

        const transformedData = Array.isArray(depositData)
          ? depositData.map((item: any) => ({
              transaction_hash: item.transaction_hash,
              block_timestamp: item.block_timestamp,
              from: item.from,
              to: item.to,
              tokenSymbol: item.tokenSymbol,
              amount: item.amount
          ? (Number(item.amount) / (item.tokenDecimal ? 10 ** item.tokenDecimal : 1)).toLocaleString("fullwide", {
              useGrouping: false,
              maximumFractionDigits: 20,
            })
          : "-",
              txHash: item.txHash,
              token: item.token,
              key: item.key,
              depositStatus: item.depositStatus,
            
            }))
          : [];
        setTransactions(transformedData);

        // Get total count from the API response
        setTotalCount(response.data?.data?.data?.totalCount || 0);
        // console.log("total count", response.data?.data?.data?.totalCount);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        setTransactions([]);
        setTotalCount(0);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDepositTransactions();
  }, [currentPage, depositStatus]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        message.success("Copied to clipboard");
      })
      .catch(() => {
        message.error("Failed to copy");
      });
  };

  const renderTruncatedAddress = (address: string) => {
    if (!address) return "-";
    return (
      <div className="group relative flex items-center gap-2">
        <span className="cursor-pointer">
          {`${address.slice(0, 6)}...${address.slice(-4)}`}
        </span>
        <CopyOutlined
          className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
          onClick={() => copyToClipboard(address)}
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

  return (
    <div className="bg-white/80 rounded-xl shadow-sm border border-gray-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                From (Ethereum)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                To (Strato)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Token
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Token Address
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Transaction Hash
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-8">
                  <div className="flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    <span className="ml-2 text-gray-500">
                      Loading transactions...
                    </span>
                  </div>
                </td>
              </tr>
            ) : !Array.isArray(transactions) || transactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <FrownOutlined style={{ fontSize: 48, color: "#bdbdbd" }} />
                    <span className="text-lg font-semibold text-gray-400">
                      Sorry, no data found
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              transactions.map((tx, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {renderTruncatedAddress(tx.from)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {renderTruncatedAddress(tx.to)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tx.tokenSymbol || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {renderTruncatedAddress(tx.token)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tx.amount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {renderTruncatedAddress(tx.transaction_hash)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tx.depositStatus === "1" ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        <Clock className="h-3 w-3 mr-1" />
                        Initiated
                      </span>
                    ) : tx.depositStatus === "2" ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Completed
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Unknown
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(tx.block_timestamp)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Ant Design Pagination */}
      <div className="px-6 py-4 flex items-center justify-between border-t border-gray-200">
        <Pagination
          current={currentPage}
          total={totalCount}
          pageSize={ITEMS_PER_PAGE}
          onChange={(page) => setCurrentPage(page)}
          showSizeChanger={false}
          showTotal={(total, range) =>
            `${range[0]}-${range[1]} of ${total} items`
          }
          disabled={isLoading}
        />
      </div>
    </div>
  );
};

export default DepositTransactionDetails;
