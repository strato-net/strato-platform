import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { formatBalance } from "@/utils/numberUtils";
import { CollateralData, NewLoanData } from "@/interface";
import { getMaxSafeWithdrawAmount } from "@/utils/lendingUtils";

interface CollateralManagementTableProps {
  collateralInfo: CollateralData[] | null;
  loadingCollateral: boolean;
  loans: NewLoanData | null;
  onSupply: (asset: CollateralData) => void;
  onWithdraw: (asset: CollateralData) => void;
}

const LoadingSpinner = () => (
  <div className="flex justify-center items-center h-12">
    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
  </div>
);

const InfoTooltip = ({ children, content }: { children: React.ReactNode; content: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="inline-flex items-center gap-1 cursor-help">
        {children}
        <HelpCircle className="h-4 w-4 text-gray-400 hover:text-gray-600" />
      </div>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">
      <p>{content}</p>
    </TooltipContent>
  </Tooltip>
);

const CollateralManagementTable = ({
  collateralInfo,
  loadingCollateral,
  loans,
  onSupply,
  onWithdraw,
}: CollateralManagementTableProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <InfoTooltip content="Manage your collateral assets. Supply tokens from your wallet or withdraw supplied collateral.">
            Collateral Management
          </InfoTooltip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>
                <InfoTooltip content="Loan-to-Value ratio: Maximum percentage of collateral value you can borrow against. Higher LTV means more borrowing power but higher risk.">
                  LTV
                </InfoTooltip>
              </TableHead>
              <TableHead>
                <InfoTooltip content="Liquidation Threshold: If your position value falls below this percentage, your collateral may be liquidated to repay your debt. Keep your position above this threshold.">
                  LT
                </InfoTooltip>
              </TableHead>
              <TableHead className="text-right">Supply</TableHead>
              <TableHead className="text-right">Withdraw</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingCollateral ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <LoadingSpinner />
                </TableCell>
              </TableRow>
            ) : collateralInfo && collateralInfo.length > 0 ? (
              collateralInfo.map((asset) => {
                const hasWalletBalance = BigInt(asset?.userBalance || 0) > 0n;
                const hasSuppliedBalance = parseFloat(asset?.collateralizedAmount || "0") > 0;
                
                // Only show assets that have either wallet balance or supplied balance
                if (!hasWalletBalance && !hasSuppliedBalance) return null;
                
                return (
                  <TableRow key={asset?.address}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {asset?.images?.[0] ? (
                          <img
                            src={asset.images[0].value}
                            alt={asset._name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
                            style={{ backgroundColor: "red" }}
                          >
                            {asset?._symbol.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{asset?._name}</div>
                          <div className="text-xs text-gray-500">{asset?._symbol}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {asset?.ltv ? (Number(asset.ltv) / 100) : 0}%
                    </TableCell>
                    <TableCell>
                      {asset?.liquidationThreshold ? (Number(asset.liquidationThreshold) / 100) : 0}%
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-4">
                        <div className="text-right">
                          <div className="font-medium">{(() => { try { const v = BigInt(asset?.userBalance || 0); return formatBalance(v <= 1n ? 0n : v, undefined, asset?.customDecimals ?? 18, 2); } catch { return formatBalance(0n, undefined, asset?.customDecimals ?? 18, 2); } })()}</div>
                          <div className="text-xs text-gray-500">
                            ${(() => { try { const v = BigInt(asset?.userBalanceValue || 0); return formatBalance(v <= 1n ? 0n : v, undefined, 18, 1, 2); } catch { return formatBalance(0n, undefined, 18, 1, 2); } })()}
                          </div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              onClick={() => onSupply(asset)}
                              disabled={!hasWalletBalance}
                            >
                              <ArrowDownCircle className="h-4 w-4 mr-1" />
                              Supply
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{hasWalletBalance ? "Deposit tokens as collateral to enable borrowing. You can withdraw these tokens later." : "No tokens in wallet to supply"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-4">
                        <div className="text-right">
                          <div className="font-medium">
                            {(() => { try { const v = BigInt(asset?.collateralizedAmount || 0); return formatBalance(v <= 1n ? 0n : v, undefined, asset?.customDecimals ?? 18, 2); } catch { return formatBalance(0n, undefined, asset?.customDecimals ?? 18, 2); } })()}
                          </div>
                          <div className="text-xs text-gray-500">
                            {(() => { try { const v = BigInt(asset?.collateralizedAmountValue || 0); return formatBalance(v <= 1n ? 0n : v, undefined, 18, 1, 2, true); } catch { return formatBalance(0n, undefined, 18, 1, 2, true); } })()}
                          </div>
                        </div>
                        {(() => {
                          const maxWithdrawAmount = getMaxSafeWithdrawAmount(asset, loans);
                          const hasCollateral = BigInt(asset?.collateralizedAmount || 0) > 0n;
                          const canWithdraw = maxWithdrawAmount > 0n;

                          let tooltipMessage = "";
                          if (canWithdraw) {
                            tooltipMessage = "Withdraw collateral.\nReduces borrowing power.";
                          } else if (!hasCollateral) {
                            tooltipMessage = "Cannot withdraw.\nNo collateral supplied for this asset.";
                          } else {
                            tooltipMessage = "Cannot withdraw.\nNo available borrowing power.";
                          }

                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help">
                                  <Button
                                    onClick={() => onWithdraw(asset)}
                                    disabled={!canWithdraw || !hasCollateral}
                                  >
                                    Withdraw
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <span>{tooltipMessage}</span>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="w-full flex justify-center items-center mt-4">
                    No collateral assets available
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default CollateralManagementTable;