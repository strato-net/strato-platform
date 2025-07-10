import { useState } from "react";
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
  const [showAllEarningAssets, setShowAllEarningAssets] = useState(false);

  const handleOptionSelect = (option: "credit-card" | "bridge") => {
    setIsOptionsModalOpen(false);
    if (option === "credit-card") {
      setIsDepositModalOpen(true);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
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
          <Button
            size="sm"
            className="flex items-center gap-1"
            onClick={() => setShowAllEarningAssets(!showAllEarningAssets)}
          >
            <div className="flex gap-1 justify-center items-center">
              <span>{showAllEarningAssets ? "Show Less" : "View All"}</span>
              {showAllEarningAssets ? (
                <ArrowUp size={20} />
              ) : (
                <ArrowDown size={20} />
              )}
            </div>
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="w-[28%] text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                  Asset
                </th>
                <th className="w-[18%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                  Price
                </th>
                <th className="w-[18%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                  Change
                </th>
                <th className="w-[18%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                  Holdings
                </th>
                <th className="w-[18%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                  Value
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
              ) : tokens.length > 0 ? (
                (showAllEarningAssets ? tokens : tokens.slice(0, 4)).map(
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
                                  <p className="font-medium text-gray-900 truncate">
                                    {asset?.token?._name || ""}
                                  </p>
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
                    </tr>
                  )
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
                    <th className="w-[28%] text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                      Asset
                    </th>
                    <th className="w-[18%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                      Price
                    </th>
                    <th className="w-[18%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                      Change
                    </th>
                    <th className="w-[18%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                      Holdings
                    </th>
                    <th className="w-[18%] text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">
                      Value
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
                                    <p className="font-medium text-gray-900 truncate">
                                      {asset?.token?._name || ""}
                                    </p>
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
