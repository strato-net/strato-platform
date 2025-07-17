import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import DepositModal from "./DepositModal";
import DepositOptionsModal from "./DepositOptionsModal";
import { Token } from "../../interface";
import { formatUnits } from "ethers";

interface AssetsProps {
  loading: boolean;
  tokens: Token[];
  isDashboard?: boolean;
  inActiveTokens: Token[];
}

const AssetsList = ({
  loading,
  tokens,
  inActiveTokens,
  isDashboard = true,
}: AssetsProps) => {
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [showNonEarningAssetsTable, setShowNonEarningAssetsTable] =
    useState(false);

  const handleOptionSelect = (option: "credit-card" | "bridge") => {
    setIsOptionsModalOpen(false);
    if (option === "credit-card") {
      setIsDepositModalOpen(true);
    }
  };

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
        <div className="p-4 text-right border-t border-gray-100 flex justify-between">
          <span className="font-bold">Earning Assets</span>
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
                  Holdings
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]">
                  Value
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4 min-w-[100px]">
                  Collateral
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr className="hover:bg-gray-50 transition-colors">
                  <td
                    colSpan={6}
                    className="py-4 px-4 whitespace-nowrap w-full"
                  >
                    <div className="w-full flex justify-center items-center h-16">
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                    </div>
                  </td>
                </tr>
              ) : tokens.length > 0 ? (
                tokens.map(
                  (asset, index) => (
                    <tr
                      key={index}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center">
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
                            : `$${parseFloat(
                              formatUnits(BigInt(asset.price), 18)
                            ).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`}
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
                          {!asset?.balance
                            ? "-"
                            : parseFloat(
                              formatUnits(BigInt(asset.balance), 18)
                            ).toLocaleString(undefined, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 4,
                            })}
                        </p>
                      </td>
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <p className="font-medium text-gray-900">
                          {!asset?.["price"] || !asset?.balance
                            ? "-"
                            : `$${(
                              parseFloat(
                                formatUnits(BigInt(asset.price), 18)
                              ) *
                              parseFloat(
                                formatUnits(BigInt(asset.balance), 18)
                              )
                            ).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`}
                        </p>
                      </td>
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <p className="font-medium text-gray-900">
                          {!asset?.collateralBalance
                            ? "-"
                            : parseFloat(
                              formatUnits(BigInt(asset.collateralBalance), 18)
                            ).toLocaleString(undefined, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 4,
                            })}
                        </p>
                      </td>
                    </tr>
                  )
                )
              ) : (
                <tr className="hover:bg-gray-50 transition-colors">
                  <td
                    colSpan={6}
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
            <span className="font-bold">Non earning Assets</span>
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
                      Holdings
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
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
                  ) : inActiveTokens.length > 0 ? (
                    inActiveTokens.map((asset, index) => (
                      <tr
                        key={index}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="py-4 px-4">
                          <div className="flex items-center">
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
                              : parseFloat(
                                  formatUnits(BigInt(asset.balance), 18)
                                ).toLocaleString(undefined, {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 4,
                                })}
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

      <DepositOptionsModal
        isOpen={isOptionsModalOpen}
        onClose={() => setIsOptionsModalOpen(false)}
        onSelectOption={handleOptionSelect}
      />
      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
      />
    </div>
  );
};

export default AssetsList;
