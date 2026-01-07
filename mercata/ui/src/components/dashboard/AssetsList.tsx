import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Token as TokenType, EarningAsset } from "@mercata/shared-types";
import { formatBalance } from "@/utils/numberUtils";

interface AssetsProps {
  loading: boolean;
  tokens: EarningAsset[];
  isDashboard?: boolean;
  inActiveTokens: TokenType[];
}

const AssetsList = ({
  loading,
  tokens,
  inActiveTokens,
  isDashboard = true,
}: AssetsProps) => {
  const [showNonEarningAssetsTable, setShowNonEarningAssetsTable] =
    useState(true);

  const hasEarningAssets = tokens.length > 0;
  const hasInactiveTokens = inActiveTokens.length > 0;
  const shouldShowLoading = loading && !hasEarningAssets;
  const shouldShowInactiveLoading = loading && !hasInactiveTokens;

  const sortedTokens = useMemo(() => {
    return [...tokens].sort((a, b) => {
      const valueA = parseFloat(a.value || "0");
      const valueB = parseFloat(b.value || "0");
      return valueB - valueA;
    });
  }, [tokens]);

  return (
    <div className="w-full overflow-hidden bg-card rounded-xl border border-border shadow-sm">
      {isDashboard && (
        <div className="p-4 md:p-5 border-b border-border">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 md:gap-0">
            <h2 className="font-bold text-xl md:text-lg">My Deposits</h2>
            <Button
              asChild
              className="w-full md:w-auto"
            >
              <a href="/dashboard/deposits" className="flex items-center justify-center gap-2">
                <Plus size={16} />
                <span>Deposit</span>
              </a>
            </Button>
          </div>
        </div>
      )}

      <div>
        {!isDashboard && (
          <div className="p-4 text-right border-b border-border flex justify-between">
            <span className="font-bold">Earning Assets</span>
          </div>
        )}
        {isDashboard && (
          <div className="p-4 text-right border-t border-border flex justify-between">
            <span className="font-bold">Earning Assets</span>
          </div>
        )}
        <div className="w-full md:overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full md:min-w-[700px]">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider py-3 px-4">
                  Asset
                </th>
                <th className="hidden md:table-cell text-right text-xs font-medium text-muted-foreground uppercase tracking-wider py-3 px-4">
                  Price
                </th>
                <th className="hidden md:table-cell text-right text-xs font-medium text-muted-foreground uppercase tracking-wider py-3 px-4">
                  Change
                </th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider py-3 px-4">
                  Balance
                </th>
                <th className="hidden md:table-cell text-right text-xs font-medium text-muted-foreground uppercase tracking-wider py-3 px-4">
                  Collateral Balance
                </th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider py-3 px-4">
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shouldShowLoading ? (
                <tr className="hover:bg-muted/50 transition-colors">
                  <td
                    colSpan={6}
                    className="py-4 px-4 whitespace-nowrap w-full"
                  >
                    <div className="w-full flex justify-center items-center h-16">
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                    </div>
                  </td>
                </tr>
              ) : sortedTokens.length > 0 ? (
                sortedTokens.map(
                  (asset, index) => (
                    <tr
                      key={index}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center">
                          {asset?.images?.[0] ? (
                            <img
                              src={asset.images[0].value}
                              alt={asset._name}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                              style={{ backgroundColor: "red" }}
                            >
                              {asset?._symbol?.slice(0, 2) || "??"}
                            </div>
                          )}
                          <div className="ml-3 min-w-0 flex-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link
                                    to={`/dashboard/deposits/${asset?.address || ''}`}
                                    className="font-medium text-blue-600 truncate hover:text-blue-800 underline transition-colors"
                                  >
                                    {asset?._name || ""}
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{asset?._name || ""}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="text-muted-foreground text-xs truncate">
                                    {asset?._symbol || ""}
                                  </p>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{asset?._symbol || ""}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      </td>
                      <td className="hidden md:table-cell py-4 px-4 whitespace-nowrap text-right">
                        <p className="font-medium text-foreground">
                          {!asset?.price
                            ? "-"
                            : formatBalance(asset.price, undefined, 18, 2, 2, true)}
                        </p>
                      </td>
                      <td className="hidden md:table-cell py-4 px-4 whitespace-nowrap text-right">
                        <div
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            (asset as any)?.["change"] >= 0
                            ? "bg-green-500/10 text-green-500"
                            : "bg-red-500/10 text-red-500"
                            }`}
                        >
                          {(asset as any)?.["change"] !== undefined
                            ? `${(asset as any)?.["change"] >= 0 ? "+" : ""}${
                              (asset as any)?.["change"]
                            }%`
                            : "-"}
                        </div>
                      </td>
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <p className="font-medium text-foreground">
                          {!asset?.balance || asset.balance === "0"
                            ? "-"
                            : formatBalance(asset.balance, undefined, 18,1, 4)}
                        </p>
                      </td>
                      <td className="hidden md:table-cell py-4 px-4 whitespace-nowrap text-right">
                        <p className="font-medium text-foreground">
                          {!asset?.collateralBalance || asset.collateralBalance === "0"
                            ? "-"
                            : formatBalance(asset.collateralBalance, undefined, 18,1,4)}
                        </p>
                      </td>
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <p className="font-medium text-foreground">
                          {!asset?.value || asset.value === "0.00" || parseFloat(asset.value) === 0
                            ? "-"
                            : `$${asset.value}`}
                        </p>
                      </td>
                    </tr>
                  )
                )
              ) : (
                <tr className="hover:bg-muted/50 transition-colors">
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
          <div className="p-4 text-right border-t border-border flex justify-between">
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
            <div className="w-full">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider py-2 md:py-3 px-2 md:px-4">
                      Asset
                    </th>
                    <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wider py-2 md:py-3 px-2 md:px-4">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shouldShowInactiveLoading ? (
                    <tr className="hover:bg-muted/50 transition-colors">
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
                        className="hover:bg-muted/50 transition-colors"
                      >
                        <td className="py-2 md:py-4 px-2 md:px-4">
                          <div className="flex items-center">
                            {asset?.images?.[0] ? (
                              <img
                                src={asset.images[0].value}
                                alt={asset._name}
                                className="w-6 h-6 md:w-8 md:h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div
                                className="w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[10px] md:text-xs text-white font-medium"
                                style={{ backgroundColor: "red" }}
                              >
                                {asset?._symbol?.slice(0, 2) || "??"}
                              </div>
                            )}
                            <div className="ml-2 md:ml-3 min-w-0 flex-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link
                                      to={`/dashboard/deposits/${asset?.address || ''}`}
                                      className="font-medium text-xs md:text-sm text-blue-600 truncate hover:text-blue-800 underline transition-colors block max-w-[120px] md:max-w-none"
                                    >
                                      {asset?._name || ""}
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{asset?._name || ""}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <p className="text-muted-foreground text-[10px] md:text-xs truncate">
                                      {asset?._symbol || ""}
                                    </p>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{asset?._symbol || ""}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 md:py-4 px-2 md:px-4 whitespace-nowrap text-right">
                          <p className="font-medium text-xs md:text-sm text-foreground">
                            {!asset?.balance || asset.balance === "0"
                              ? "-"
                              : formatBalance(asset.balance, undefined, 18,1,4)}
                          </p>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="hover:bg-muted/50 transition-colors">
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
