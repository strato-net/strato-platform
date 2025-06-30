import { useEffect, useState, useMemo, useCallback } from "react";
import { formatEther, formatUnits, parseUnits } from "ethers";
import { PiggyBank } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { useLendingMetrics } from "@/hooks/useLendingMetrics";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import BorrowingSection from "../components/dashboard/BorrowingSection";
import BorrowAssetModal from "@/components/dashboard/BorrowAssetModal";
import RepayModal from "@/components/dashboard/RepayModal";
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

import { DepositableToken } from "@/interface";
import { usdstAddress } from "@/lib/contants";
import isEqual from "lodash.isequal";

const LoadingSpinner = () => (
  <div className="flex justify-center items-center h-12">
    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
  </div>
);

const formatTokenAmount = (value: any) =>
  parseFloat(formatUnits(value || 0, 18)).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });


const Borrow = () => {
  const [selectedAsset, setSelectedAsset] = useState<DepositableToken | null>(null);
  const [borrowAsset, setBorrowAsset] = useState<DepositableToken | null>(null);
  const [isBorrowModalOpen, setIsBorrowModalOpen] = useState(false);
  const [tokens, setTokens] = useState<DepositableToken[] | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false)
  const [loan, setLoan] = useState<any | null>(null);
  const [wrongAmount, setWrongAmount] = useState(false);

  const { toast } = useToast();
  const {
    depositableTokens,
    refreshDepositTokens,
    refreshLoans,
    loans,
    loadingDepositTokens,
    borrowAsset: borrowAssetFn,
  } = useLendingContext();

  const { 
    availableBorrowingPower, 
    currentBorrowed, 
    averageInterestRate, 
    loanList,
    setLoanList,
    refreshLendingData,
    loading: lendingLoading
  } = useLendingMetrics();

  useEffect(() => {
    refreshLendingData();
  }, []);

  useEffect(() => {
    if (!depositableTokens || depositableTokens.length === 0) return;

    let usdtToken: DepositableToken | null = null;
    const filteredTokens: DepositableToken[] = [];

    for (const token of depositableTokens) {
      if (token?.address === usdstAddress) {
        usdtToken = token;
      } else {
        filteredTokens.push(token);
      }
    }
    setBorrowAsset(usdtToken);
    setTokens(filteredTokens);
  }, [depositableTokens]);

  const sortedAssets = useMemo(() => {
    return (tokens ?? []).slice().sort((a, b) => parseFloat(b?.value) - parseFloat(a?.value));
  }, [tokens]);

  const handleBorrow = (asset: DepositableToken) => {
    setSelectedAsset(asset);
    setIsBorrowModalOpen(true);
  };

  const closeBorrowModal = () => {
    setIsBorrowModalOpen(false);
    setSelectedAsset(null);
  };

  const executeBorrow = async (asset: DepositableToken, amount: number) => {
    try {
      setBorrowLoading(true);
      const collateralAmount = formatUnits(BigInt(selectedAsset?.value || 0), 18);
      const amountInWei = parseUnits(amount.toString(), 18).toString();
      const collateralInWei = parseUnits(collateralAmount, 18).toString();

      await borrowAssetFn({
        asset: borrowAsset?.address!,
        amount: amountInWei,
        collateralAsset: asset?.address!,
        collateralAmount: collateralInWei,
      });

      toast({
        title: "Borrow Initiated",
        description: `You borrowed ${amount} USDT against your ${asset._name}.`,
        variant: "success",
      });

      setBorrowLoading(false);
      setIsBorrowModalOpen(false);
      await refreshLendingData();
      await refreshDepositTokens();

      // Poll loans until list length changes (max 5 attempts)
      const pollLoans = async (attempt = 0) => {
        if (attempt >= 5) return;
        await refreshLoans();
        const updatedLoans = (await refreshLoans() as unknown) as any[];
        if (updatedLoans.length > 0) return; // at least one loan now visible
        setTimeout(() => pollLoans(attempt + 1), 2000);
      };
      pollLoans();
    } catch (error: any) {
      console.log(error, "error");
      setBorrowLoading(false);
      setIsBorrowModalOpen(false);
      toast({
        title: "Borrow Error",
        description: `Something went wrong - ${error?.message || "Please try again later."
          }`,
        variant: "destructive",
      });
    }
  };

  const fetchLoans = useCallback(async () => {
    const userData = JSON.parse(localStorage.getItem("user") || "{}");
    const addr = userData.userAddress;
    try {
      // Handle both array and object-map shapes
      const loanArray: any[] = Array.isArray(loans)
        ? loans
        : Object.entries(loans).map(([loanId, loan]: [string, any]) => ({ loanId, ...loan }));

      const addrLc = addr?.toLowerCase();
      const userLoans = loanArray.filter(
        (loan: any) =>
          loan?.loan?.user?.toLowerCase() === addrLc && loan?.loan?.active === true
      );

      // Enrich each loan with token symbol, name, and human-readable balance
      const enrichedLoans = await Promise.all(
        userLoans.map(async (loan: any) => {
          const balanceHuman = formatUnits(
            BigInt(loan?.loan?.amount || 0) + BigInt(loan?.loan?.interest || 0),
            18
          );
          const hf = loan?.loan?.healthFactor ?? loan.healthFactor;
          return {
            ...loan,
            _name: loan.assetName,
            _symbol: loan?.assetSymbol || "",
            balanceHuman,
            healthFactor: hf,
            loan: {
              ...loan.loan,
              healthFactor: hf,
            },
          };
        })
      );
      setLoanList(prev => (isEqual(prev, enrichedLoans) ? prev : enrichedLoans));
      if (typeof window !== "undefined") {
        // @ts-ignore
        window.__LOAN_LIST__ = enrichedLoans;
      }
    } catch (e) {
      console.error("Error fetching loans:", e);
    }
  }, [loans]);

  useEffect(() => {
    const loanCount = Array.isArray(loans)
      ? loans.length
      : Object.keys(loans || {}).length;

    if (loanCount === 0) {
      // No active loans – clear any previous data so the table updates immediately.
      if (loanList.length > 0) {
        console.debug("[Loans sync] Cleared stale loan list (was", loanList.length, ")");
      }
      setLoanList([]);
      return;
    }

    console.debug("[Loans sync] Refreshing loans. loanCount:", loanCount);
    fetchLoans();
  }, [loans, fetchLoans]);



  // ----- Pool liquidity (USDST) -----
  const poolLiquidity = useMemo(() => {
    if (!borrowAsset) return 0;
    try {
      return parseFloat(formatUnits(
        typeof borrowAsset?.liquidity === "number" || (typeof borrowAsset?.liquidity === "string" && borrowAsset.liquidity.includes("e"))
          ? BigInt(Number(borrowAsset.liquidity)).toString()
          : borrowAsset?.liquidity?.toString() || "0",
        18
      ));
    } catch {
      return 0;
    }
  }, [borrowAsset]);

  const collateralCap = (asset: DepositableToken) => {
    try {
      const price = parseFloat(formatUnits(
        typeof asset?.price === "number" || (typeof asset?.price === "string" && asset.price.includes("e"))
          ? BigInt(Number(asset.price)).toString()
          : asset?.price?.toString() || "0",
        18
      ));
      const value = parseFloat(formatUnits(
        typeof asset?.value === "number" || (typeof asset?.value === "string" && asset.value.includes("e"))
          ? BigInt(Number(asset.value)).toString()
          : asset?.value?.toString() || "0",
        18
      ));
      const ratio = Number(asset?.collateralRatio || "0") / 100;
      if (ratio === 0) return 0;
      const maxBorrowable = (price * value) / ratio;
      return maxBorrowable;
    } catch {
      return 0;
    }
  };

  const formatMaxBorrowable = (asset: DepositableToken) => {
    const maxBorrowable = collateralCap(asset);
    const effective = Math.min(maxBorrowable, poolLiquidity);
    return "$" + effective.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />

      <div className="flex-1 ml-64">
        <DashboardHeader title="Borrow" />

        <main className="p-6">
          <div className="mb-8">
            <BorrowingSection 
              availableBorrowingPower={availableBorrowingPower}
              currentBorrowed={currentBorrowed}
              averageInterestRate={averageInterestRate}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Borrow</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Collateral Ratio</TableHead>
                    <TableHead>Pool Liquidity</TableHead>
                    <TableHead>Max Borrow based on Collateral</TableHead>
                    <TableHead>USDST Available to Borrow</TableHead>
                    <TableHead>Borrow Fee</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDepositTokens ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <LoadingSpinner />
                      </TableCell>
                    </TableRow>
                  ) : sortedAssets.length > 0 ? (
                    sortedAssets.map((asset) => (
                      <TableRow key={asset?.address}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
                              style={{ backgroundColor: "red" }}
                            >
                              {asset?._symbol.slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-medium">{asset?._name}</div>
                              <div className="text-xs text-gray-500">{asset?._symbol}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{formatTokenAmount(asset?.value)}</TableCell>
                        <TableCell>
                          {asset?.collateralRatio
                            ? (Number(asset.collateralRatio) / 100).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const liq = poolLiquidity;
                            return "$" + liq.toLocaleString("en-US", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 2,
                            });
                          })()}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const cap = collateralCap(asset);
                            return "$" + cap.toLocaleString("en-US", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 2,
                            });
                          })()}
                        </TableCell>
                        <TableCell>{formatMaxBorrowable(asset)}</TableCell>
                        <TableCell>
                          {borrowAsset?.interestRate
                            ? `${parseFloat(borrowAsset.interestRate).toFixed(2)}%`
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() => handleBorrow(asset)}
                            className="flex items-center gap-1"
                          >
                            <PiggyBank size={16} />
                            Borrow
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) :
                    <TableRow>
                      <TableCell colSpan={7}>
                        <div className="w-full flex justify-center items-center mt-4">
                          No data to show
                        </div>
                      </TableCell>
                    </TableRow>
                  }
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>My Loans</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Collateral</TableHead>
                    <TableHead>Accrued Interest</TableHead>
                    <TableHead>Health Factor</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lendingLoading ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <LoadingSpinner />
                      </TableCell>
                    </TableRow>
                  ) : loanList?.length > 0 ? (
                    loanList?.map((loan, loanIndex) => (
                      <TableRow key={loanIndex}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
                              style={{ backgroundColor: "red" }}
                            >
                              {loan?.loan?.assetSymbol?.slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-medium">{loan?.loan.assetName || loan?.loan.asset}</div>
                              <div className="text-xs text-gray-500">{loan?.loan?.assetSymbol}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>${formatUnits(loan?.loan?.amount?.toString(), 18)}</TableCell>
                        <TableCell>
                          {loan?.loan.collateralName || loan?.loan.collateralAsset} {formatEther(loan?.loan?.collateralAmount || 0)}
                        </TableCell>
                        <TableCell>{formatEther(loan?.loan?.interest || 0)}</TableCell>
                        <TableCell>
                          {(() => {
                            const raw = loan?.loan?.healthFactor;
                            const hfNum = raw !== undefined ? parseFloat(raw.toString()) : NaN;
                            if (!isFinite(hfNum)) return "∞";
                            const color = hfNum < 1
                              ? "text-red-600"
                              : hfNum < 1.1
                                ? "text-yellow-600"
                                : "text-green-600";
                            return <span className={color}>{hfNum.toFixed(2)}</span>;
                          })()}
                        </TableCell>
                        <TableCell>
                          <Button
                            onClick={() => {
                              setLoan(loan)
                              setShowRepayModal(true)
                            }}
                          >
                            Repay
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) :
                    <TableRow>
                      <TableCell colSpan={4}>
                        <div className="w-full flex justify-center items-center mt-4">
                          No data to show
                        </div>
                      </TableCell>
                    </TableRow>
                  }
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </div>

      {selectedAsset && (
        <BorrowAssetModal
          borrowLoading={borrowLoading}
          borrowAsset={borrowAsset}
          asset={selectedAsset}
          isOpen={isBorrowModalOpen}
          onClose={closeBorrowModal}
          onBorrow={(amount) => executeBorrow(selectedAsset, amount)}
        />
      )}

      <RepayModal
        isOpen={showRepayModal}
        onClose={() => {
          setShowRepayModal(false);
          setLoan(null);
        }}
        loan={loan}
        onRepaySuccess={async () => {
          await refreshLoans();
          await refreshDepositTokens();
        }}
      />
 
    </div>
  );
};

export default Borrow;
