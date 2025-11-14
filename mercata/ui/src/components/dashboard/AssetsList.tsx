import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Token } from "../../interface";
import { formatUnits } from "ethers";
import { formatBalance, safeParseUnits, calculateTokenValue } from "@/utils/numberUtils";
import { useUserTokens } from "@/context/UserTokensContext";
import { api } from "@/lib/axios";

interface AssetsProps {
  loading: boolean;
  tokens: Token[];
  isDashboard?: boolean;
  inActiveTokens: Token[];
  shouldPreventFlash?: boolean;
}

const AssetsList = ({
  loading,
  tokens,
  inActiveTokens,
  isDashboard = true,
  shouldPreventFlash = false,
}: AssetsProps) => {
  const [showNonEarningAssetsTable, setShowNonEarningAssetsTable] = useState(false);
  const [activeTab, setActiveTab] = useState<"balance" | "collateral">("balance");
  const [expandedTokenAddress, setExpandedTokenAddress] = useState<string | null>(null);
  const [tokenValueData, setTokenValueData] = useState<Record<string, { balance: string; collateralBalance: string; price: string; loading: boolean }>>({});
  
  const {
    balanceTokens,
    collateralTokens,
    balanceInactiveTokens,
    collateralInactiveTokens,
    loadingBalance,
    loadingCollateral,
    fetchBalanceTokens,
    fetchCollateralTokens,
  } = useUserTokens();

  const fetchTokenValue = async (tokenAddress: string) => {
    if (tokenValueData[tokenAddress]?.loading) return;
    
    setTokenValueData(prev => ({
      ...prev,
      [tokenAddress]: { ...prev[tokenAddress], loading: true }
    }));

    try {
      const response = await api.get(`/tokens/balance?tokenAddress=${tokenAddress}`);
      setTokenValueData(prev => ({
        ...prev,
        [tokenAddress]: {
          balance: response.data.balance || "0",
          collateralBalance: response.data.collateralBalance || "0",
          price: response.data.price || "0",
          loading: false
        }
      }));
    } catch (error) {
      setTokenValueData(prev => ({
        ...prev,
        [tokenAddress]: {
          balance: "0",
          collateralBalance: "0",
          price: "0",
          loading: false
        }
      }));
    }
  };

  const handleValueClick = (tokenAddress: string) => {
    if (expandedTokenAddress === tokenAddress) {
      setExpandedTokenAddress(null);
    } else {
      setExpandedTokenAddress(tokenAddress);
      if (!tokenValueData[tokenAddress]) {
        fetchTokenValue(tokenAddress);
      }
    }
  };

  useEffect(() => {
    if (activeTab === "balance") {
      fetchBalanceTokens();
    } else {
      fetchCollateralTokens();
    }
  }, [activeTab, fetchBalanceTokens, fetchCollateralTokens]);

  const currentLoading = activeTab === "balance" ? loadingBalance : loadingCollateral;
  const currentTokens = activeTab === "balance" ? balanceTokens : collateralTokens;
  const currentInactiveTokens = activeTab === "balance" ? balanceInactiveTokens : collateralInactiveTokens;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm w-full overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg">My Deposits</h2>
          {isDashboard && (
            <Button
              size="sm"
            >
              <Plus size={16} />
              <a
                href="/dashboard/deposits"
                className="text-sm text-white flex items-center justify-end"
              >
                Add Deposits
              </a>
            </Button>
          )}
        </div>
      </div>

      <div>
        <div className="p-4 border-t border-gray-100">
          <div className="flex justify-between items-center mb-4">
            <span className="font-bold">Earning Assets</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={activeTab === "balance" ? "default" : "outline"}
                onClick={() => setActiveTab("balance")}
              >
                Balance
              </Button>
              <Button
                size="sm"
                variant={activeTab === "collateral" ? "default" : "outline"}
                onClick={() => setActiveTab("collateral")}
              >
                Collateral
              </Button>
            </div>
          </div>
        </div>
        <div className="w-full overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table style={{ minWidth: '700px', width: '100%' }}>
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[140px]">
                  Asset
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[80px]">
                  Price
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[80px]">
                  Change
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]">
                  {activeTab === "balance" ? "Balance" : "Collateral Balance"}
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]">
                  View Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {currentLoading ? (
                <tr className="hover:bg-gray-50 transition-colors">
                  <td
                    colSpan={5}
                    className="py-4 px-4 whitespace-nowrap w-full"
                  >
                    <div className="w-full flex justify-center items-center h-16">
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                    </div>
                  </td>
                </tr>
              ) : currentTokens.length > 0 ? (
                currentTokens.flatMap(
                  (asset, index) => [
                    <tr
                      key={`${asset.address}-${index}`}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center">
                          {asset?.token?.images?.[0] ? (
                            <img
                              src={asset.token.images[0].value}
                              alt={asset.token._name}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                              style={{ backgroundColor: "red" }}
                            >
                              {asset?.token?._symbol?.slice(0, 2) || "??"}
                            </div>
                          )}
                          <div className="ml-3 min-w-0 flex-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link
                                    to={`/dashboard/deposits/${asset?.token?.address || ''}`}
                                    className="font-medium text-blue-600 truncate hover:text-blue-800 underline transition-colors"
                                  >
                                    {asset?.token?._name || ""}
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{asset?.token?._name || ""}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="text-gray-500 text-xs truncate">
                                    {asset?.token?._symbol || ""}
                                  </p>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{asset?.token?._symbol || ""}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <p className="font-medium text-gray-900">
                          {!asset?.["price"]
                            ? "-"
                            : formatBalance(asset.price, undefined, 18, 2, 2, true)}
                        </p>
                      </td>
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <div
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            asset?.["change"] >= 0
                            ? "bg-green-50 text-green-600"
                            : "bg-red-50 text-red-600"
                            }`}
                        >
                          {asset?.["change"] !== undefined
                            ? `${asset?.["change"] >= 0 ? "+" : ""}${
                              asset?.["change"]
                            }%`
                            : "-"}
                        </div>
                      </td>
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <p className="font-medium text-gray-900">
                          {(() => {
                            const value = activeTab === "balance" ? asset?.balance : asset?.collateralBalance;
                            return !value ? "-" : formatBalance(value, undefined, 18, 1, 4);
                          })()}
                        </p>
                      </td>
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => handleValueClick(asset.address)}
                          className="font-medium text-blue-600 hover:text-blue-800 underline cursor-pointer flex items-center gap-1 ml-auto"
                        >
                          View Details
                          {expandedTokenAddress === asset.address ? (
                            <ChevronUp size={16} className="inline" />
                          ) : (
                            <ChevronDown size={16} className="inline" />
                          )}
                        </button>
                      </td>
                    </tr>,
                    expandedTokenAddress === asset.address && (
                      <tr key={`${asset.address}-expanded-${index}`}>
                        <td colSpan={5} className="px-4 py-4 bg-gray-50">
                          {tokenValueData[asset.address]?.loading ? (
                            <div className="flex justify-center items-center py-4">
                              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                            </div>
                          ) : (
                            <div className="bg-white rounded-lg border border-gray-200 p-4">
                              <h4 className="font-semibold mb-4 text-gray-800">Token Details</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200">
                                      <th className="text-left py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Token</th>
                                      <th className="text-right py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Price</th>
                                      <th className="text-right py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Balance</th>
                                      <th className="text-right py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Collateral</th>
                                      <th className="text-right py-3 px-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Value</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {(() => {
                                      const valueData = tokenValueData[asset.address];
                                      if (!valueData) return null;
                                      
                                      const balance = valueData.balance || "0";
                                      const collateral = valueData.collateralBalance || "0";
                                      const price = valueData.price || "0";
                                      
                                      const totalValue = price !== "0"
                                        ? calculateTokenValue(balance, price, collateral)
                                        : "0.00";
                                      
                                      return (
                                        <tr className="hover:bg-gray-50">
                                          <td className="py-3 px-4 font-medium text-gray-900">
                                            {asset?.token?._name || asset?.token?._symbol || "-"}
                                          </td>
                                          <td className="py-3 px-4 text-right text-gray-700">
                                            {price !== "0" ? formatBalance(price, undefined, 18, 2, 2, true) : "-"}
                                          </td>
                                          <td className="py-3 px-4 text-right text-gray-700">
                                            {balance !== "0" ? formatBalance(balance, undefined, 18, 1, 4) : "-"}
                                          </td>
                                          <td className="py-3 px-4 text-right text-gray-700">
                                            {collateral !== "0" ? formatBalance(collateral, undefined, 18, 1, 4) : "-"}
                                          </td>
                                          <td className="py-3 px-4 text-right font-medium text-gray-900">
                                            {price !== "0" ? `$${totalValue}` : "-"}
                                          </td>
                                        </tr>
                                      );
                                    })()}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  ].filter(Boolean)
                )
              ) : (
                <tr className="hover:bg-gray-50 transition-colors">
                  <td
                    colSpan={5}
                    className="py-4 px-4 whitespace-nowrap w-full"
                  >
                    <div className="w-full flex justify-center items-center h-16">
                      <div>No data to show</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isDashboard && (
        <div>
          <div className="p-4 text-right border-t border-gray-100 flex justify-between">
            <span className="font-bold">Non-earning Assets</span>
            <div className="flex gap-4">
              <Button
                size="sm"
                onClick={() => setShowNonEarningAssetsTable((prev) => !prev)}
              >
                <div className="flex gap-1 justify-center items-center">
                  {showNonEarningAssetsTable ? (
                    <ChevronUp size={20} />
                  ) : (
                    <ChevronDown size={20} />
                  )}
                </div>
              </Button>
            </div>
          </div>
          <div
            className={`transition-all duration-300 ease-in-out overflow-hidden ${
              showNonEarningAssetsTable
                ? "max-h-[400px] opacity-100"
                : "max-h-0 opacity-0"
            }`}
          >
            <div className="overflow-y-auto max-h-[400px]">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="w-[50%] text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                      Asset
                    </th>
                    <th className="w-[50%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {currentLoading ? (
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td
                        colSpan={2}
                        className="py-4 px-4 whitespace-nowrap w-full"
                      >
                        <div className="w-full flex justify-center items-center h-16">
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                        </div>
                      </td>
                    </tr>
                  ) : currentInactiveTokens.length > 0 ? (
                    currentInactiveTokens.map((asset, index) => (
                      <tr
                        key={index}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="py-4 px-4">
                          <div className="flex items-center">
                            {asset?.token?.images?.[0] ? (
                              <img
                                src={asset.token.images[0].value}
                                alt={asset.token._name}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                                style={{ backgroundColor: "red" }}
                              >
                                {asset?.token?._symbol?.slice(0, 2) || "??"}
                              </div>
                            )}
                            <div className="ml-3 min-w-0 flex-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link
                                      to={`/dashboard/deposits/${asset?.token?.address || ''}`}
                                      className="font-medium text-blue-600 truncate hover:text-blue-800 underline transition-colors"
                                    >
                                      {asset?.token?._name || ""}
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{asset?.token?._name || ""}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <p className="text-gray-500 text-xs truncate">
                                      {asset?.token?._symbol || ""}
                                    </p>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{asset?.token?._symbol || ""}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4 whitespace-nowrap text-right">
                          <p className="font-medium text-gray-900">
                            {!asset?.balance
                              ? "-"
                              : formatBalance(asset.balance, undefined, 18,1,4)}
                          </p>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td
                        colSpan={5}
                        className="py-4 px-4 whitespace-nowrap w-full"
                      >
                        <div className="w-full flex justify-center items-center h-16">
                          <div>No data to show</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetsList;
