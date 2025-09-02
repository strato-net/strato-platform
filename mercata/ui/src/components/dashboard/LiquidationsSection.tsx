import React, { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import CopyButton from "../ui/copy";
import { LiquidationEntry, useLiquidationContext } from "@/context/LiquidationContext";
import LiquidateModal from "./LiquidateModal";
import { CollateralData } from "@/interface";
import TokenDisplay from "@/components/ui/TokenDisplay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { useUser } from "@/context/UserContext";
const shorten = (addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4);
const weiToEther = (v?: string) => {
  if (!v) return 0;
  try {
    return Number(BigInt(v)) / 1e18;
  } catch {
    return 0;
  }
};

const LiquidationsSection: React.FC = () => {
  const { liquidatable, loading, error, refreshData } = useLiquidationContext();
  const { userAddress } = useUser();
 

  const [modalData, setModalData] = React.useState<{
    loan: LiquidationEntry;
    collateral: CollateralData;
  } | null>(null);

  // You cannot liquidate your own loans
  const isOwnLoan = (loan: LiquidationEntry) => loan.user.toLowerCase() === userAddress?.toLowerCase();

  // Refresh liquidation data when component mounts (tab is opened)
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const openModal = (loan: LiquidationEntry, collateral: CollateralData) => setModalData({ loan, collateral });
  const closeModal = () => setModalData(null);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggle = (id: string) => {
    setExpanded((p) => ({ ...p, [id]: !p[id] }));
  };

  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg md:text-xl">Liquidatable Positions</CardTitle>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        {loading ? (
          <div className="flex justify-center items-center h-12">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
          </div>
        ) : liquidatable.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No liquidatable positions available
          </div>
        ) : (
          <div className="space-y-3 md:space-y-4">
            {liquidatable.map((ln: LiquidationEntry) => (
              <div key={ln.id} className="border rounded-lg overflow-hidden">
                {/* Main row */}
                <div 
                  className="p-4 hover:bg-gray-50 cursor-pointer"
                  onClick={() => toggle(ln.id)}
                >
                  {/* Mobile layout */}
                  <div className="block md:hidden">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="text-gray-500">
                          {expanded[ln.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </div>
                        <span className="font-medium text-sm">{shorten(ln.user)}</span>
                        <CopyButton address={ln.user} />
                      </div>
                      <div className={`text-sm font-medium ${ln.healthFactor < 1 ? 'text-red-600' : 'text-yellow-600'}`}>
                        {(ln.healthFactor * 100).toFixed(2)}%
                      </div>
                    </div>
                    {/* Alert users to their own unhealthy loans, which they cannot liquidate */}
                    {isOwnLoan(ln) && (
                      <div className="text-sm text-red-500">
                        <span className="font-medium">(You)</span>
                      </div>
                    )}
                    <div className="text-sm text-gray-600">
                      Borrowed: <span className="font-medium">{weiToEther(ln.amount).toFixed(2)} {ln.assetSymbol}</span>
                    </div>
                  </div>
                  
                  {/* Desktop layout */}
                  <div className="hidden md:flex md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                      {/* Expand icon */}
                      <div className="text-gray-500">
                        {expanded[ln.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </div>
                      
                      {/* Borrower */}
                      <div>
                        <div className="flex items-center gap-2">
                        <div className="text-sm text-gray-500">Borrower</div>
                        {isOwnLoan(ln) && (
                        <div className="text-sm text-red-500">
                          <span className="font-medium">(You)</span>
                        </div>
                      )} </div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{shorten(ln.user)}</span>
                          <CopyButton address={ln.user} />
                        </div>
                      </div>
                    </div>
                    
                    {/* Borrowed amount */}
                    <div>
                      <div className="text-sm text-gray-500">Borrowed</div>
                      <div className="font-medium">
                        {weiToEther(ln.amount).toFixed(2)} {ln.assetSymbol}
                      </div>
                    </div>
                    
                    {/* Health Factor */}
                    <div>
                      <div className="text-sm text-gray-500">Health Factor</div>
                      <div className={`font-medium ${ln.healthFactor < 1 ? 'text-red-600' : 'text-yellow-600'}`}>
                        {(ln.healthFactor * 100).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded collateral details */}
                {expanded[ln.id] && (
                  <div className="bg-gray-50 p-4">
                    {/* Mobile layout */}
                    <div className="block md:hidden space-y-3">
                      {ln.collaterals.map((c: CollateralData, idx: number) => {
                        const usdVal = weiToEther(c.usdValue).toFixed(2);
                        const profitNum = Number(BigInt(c.expectedProfit)) / 1e18;
                        const positive = profitNum > 0;
                        const profit = profitNum.toFixed(2);
                        return (
                          <div key={idx} className="bg-white p-3 rounded border">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <TokenDisplay 
                                  symbol={c.symbol || "UNKNOWN"} 
                                  showName={false}
                                  size="sm"
                                />
                                <span className="font-medium text-sm">{c.symbol || "UNKNOWN"}</span>
                              </div>
                              <Button 
                                size="sm" 
                                variant="destructive" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openModal(ln, c);
                                }}
                                disabled={isOwnLoan(ln)}
                              >
                                Liquidate
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-gray-500">Amount: </span>
                                <span className="font-medium">{weiToEther(c.amount).toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">Value: </span>
                                <span className="font-medium">${usdVal}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-gray-500">Expected Profit: </span>
                                <span className={positive ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                                  ${profit}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    
                    {/* Desktop table layout */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Collateral Asset</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Value (USD)</TableHead>
                            <TableHead>Expected Profit</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ln.collaterals.map((c: CollateralData, idx: number) => {
                            const usdVal = weiToEther(c.usdValue).toFixed(2);
                            const profitNum = Number(BigInt(c.expectedProfit)) / 1e18;
                            const positive = profitNum > 0;
                            const profit = profitNum.toFixed(2);
                            return (
                              <TableRow key={idx}>
                                <TableCell>
                                  <TokenDisplay 
                                    symbol={c.symbol || "UNKNOWN"} 
                                    showName={false}
                                    size="sm"
                                  />
                                </TableCell>
                                <TableCell className="font-medium">
                                  {weiToEther(c.amount).toFixed(2)}
                                </TableCell>
                                <TableCell className="font-medium">
                                  ${usdVal}
                                </TableCell>
                                <TableCell>
                                  <span className={positive ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                                    ${profit}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Button 
                                    size="sm" 
                                    variant="destructive" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openModal(ln, c);
                                    }}
                                    disabled={isOwnLoan(ln)}
                                  >
                                    Liquidate
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      
      {modalData && (
        <LiquidateModal
          key={`${modalData.loan.user || modalData.loan.id}-${modalData.collateral.asset}`}
          open={!!modalData}
          onOpenChange={(open) => {
            if (!open) closeModal();
          }}
          loan={modalData.loan}
          collateral={modalData.collateral}
          onSuccess={async () => {
            await refreshData();
            closeModal();
          }}
        />
      )}
    </Card>
  );
};

export default LiquidationsSection; 