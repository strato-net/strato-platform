import { useEffect, useState, useMemo, useCallback } from "react";
import { formatEther, formatUnits, parseUnits } from "ethers";
import { PiggyBank } from "lucide-react";

import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";

import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import BorrowingSection from "../components/dashboard/BorrowingSection";
import BorrowAssetModal from "@/components/dashboard/BorrowAssetModal";

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

import { DepositableToken, Loan } from "@/interface";
import { usdstAddress } from "@/lib/contants";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

const formatMaxBorrowable = (asset: DepositableToken) => {
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
    if (ratio === 0) return "$0.00";
    const maxBorrowable = (price * value) / ratio;
    return (
      "$" +
      maxBorrowable.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      })
    );
  } catch {
    return "$0.00";
  }
};

const Borrow = () => {
  const [selectedAsset, setSelectedAsset] = useState<DepositableToken | null>(null);
  const [borrowAsset, setBorrowAsset] = useState<DepositableToken | null>(null);
  const [isBorrowModalOpen, setIsBorrowModalOpen] = useState(false);
  const [tokens, setTokens] = useState<DepositableToken[] | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [repayAmount, setRepayAmount] = useState('')
  const [showRepayModal, setShowRepayModal] = useState(false)
  const [repayLoading, setRepayLoading] = useState(false);
  const [loan, setLoan] = useState<any | null>(null);
  const [loanList, setLoanList] = useState<any[]>([]);
  const [wrongAmount, setWrongAmount] = useState(false);

  const { toast } = useToast();
  const {
    depositableTokens,
    refreshDepositTokens,
    loadingDepositTokens,
    loans,
    refreshLoans,
    loadingLoans,
    borrowAsset: borrowAssetFn,
    repayLoan: repayLoanFn,
  } = useLendingContext();

  useEffect(() => {
    refreshDepositTokens()
    refreshLoans()
  }, [])

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
      await refreshDepositTokens();

      // Poll loans until list length changes (max 5 attempts)
      const pollLoans = async (attempt = 0) => {
        if (attempt >= 5) return;
        await refreshLoans();
        const updatedLoans = (await fetchLoans() as unknown) as any[];
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

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      setRepayAmount(value);
      // wrongAmount now flags when user tries to repay more than wallet balance (optional)
      // but we no longer block over-repay; we'll clip to total owed on submit
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
          return {
            ...loan,
            _name: loan.assetName,
            _symbol: loan?.assetSymbol || "",
            balanceHuman,
          };
        })
      );
      setLoanList(enrichedLoans);
    } catch (e) {
      console.error("Error fetching loans:", e);
    }
  }, [loans]);

  useEffect(() => {
    if (Object.keys(loans || {}).length > 0) {
      fetchLoans();
    }
  }, [loans, fetchLoans]);

  const repayLoan = async () => {
    try {
      setRepayLoading(true);
      const totalOwedWei = (BigInt(loan?.loan?.amount || 0) + BigInt(loan?.loan?.interest || 0)).toString();
      let amountInWei = parseUnits(repayAmount === "" ? "0" : repayAmount, 18).toString();
      if (BigInt(amountInWei) > BigInt(totalOwedWei)) {
        amountInWei = totalOwedWei; // clip to full repay
      }

      const response = await repayLoanFn({
        loanId: loan?.key,
        amount: amountInWei,
        asset: loan?.loan?.asset,
      });
      console.log(response, "repay loan response");
      setRepayLoading(false);
      toast({
        title: "Repay Submitted",
        description: `Successfully repaid ${repayAmount} ${loan?._symbol}`,
        variant: "success",
      });
      setShowRepayModal(false);

      // Poll until loan disappears or becomes inactive
      const pollAfterRepay = async (attempt = 0) => {
        if (attempt >= 5) return;
        await refreshLoans();
        const updatedLoans = (await fetchLoans() as unknown) as any[];
        const target = updatedLoans.find((l: any) => l.key === loan?.key);
        if (!target || !target.loan?.active) {
          // Loan cleared; collateral should be returned. Poll deposit tokens up to 5 times
          const pollDeposits = async (depAttempt = 0) => {
            if (depAttempt >= 5) return;
            await refreshDepositTokens();
            // give context state a chance to propagate before next check
            setTimeout(() => pollDeposits(depAttempt + 1), 2000);
          };
          pollDeposits();
          return;
        }
        setTimeout(() => pollAfterRepay(attempt + 1), 2000);
      };
      pollAfterRepay();
    } catch (error) {
      api["error"]({
        message: "Error",
        description: `Repay Error - ${error}`,
      });
      setRepayLoading(false);
      console.error("Error repaying loan:", error);
    } finally {
      setRepayAmount("");
      setRepayLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />

      <div className="flex-1 ml-64">
        <DashboardHeader title="Borrow" />

        <main className="p-6">
          <div className="mb-8">
            <BorrowingSection />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Borrow Against Your Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Collateral Ratio</TableHead>
                    <TableHead>USDST Available to Borrow</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDepositTokens ? (
                    <TableRow>
                      <TableCell colSpan={6}>
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
                        <TableCell>{formatMaxBorrowable(asset)}</TableCell>
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

          <Card>
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
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingLoans ? (
                    <TableRow>
                      <TableCell colSpan={4}>
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
      <Dialog open={showRepayModal} onOpenChange={setShowRepayModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Repay Loan</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4">
            {/* First Token */}
            <div className="rounded-lg border p-3">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-500">Amount</span>
              </div>
              <div className="flex items-center">
                <Input
                  placeholder="0"
                  className="border-none text-xl font-medium p-0 pl-2 h-auto focus-visible:ring-0"
                  value={repayAmount}
                  onChange={handleAmountChange}
                />
              </div>
            </div>
          </div>
          {loan && (
            <div className="mt-2 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800 mb-1">
                <span className="font-medium">Principal:</span> {formatUnits(loan?.loan?.amount || 0, 18)} {loan?.loan?._symbol}
              </p>
              <p className="text-sm text-blue-800 mb-1">
                <span className="font-medium">Interest:</span> {formatUnits(loan?.loan?.interest || 0, 18)} {loan?.loan?._symbol}
              </p>
              <p className="text-sm font-medium text-blue-900">
                Total outstanding: {loan?.balanceHuman} {loan?.loan?._symbol}
              </p>
              <button
                className="mt-2 text-xs text-blue-600 underline"
                type="button"
                onClick={() => setRepayAmount(loan?.balanceHuman || "")}
              >
                Repay All
              </button>
            </div>
          )}

          <div className="pt-2">
            <Button
              onClick={repayLoan}
              disabled={
                repayLoading ||
                !repayAmount ||
                isNaN(Number(repayAmount)) ||
                Number(repayAmount) <= 0
              }
              type="submit"
              className="w-full bg-strato-purple hover:bg-strato-purple/90"
            >
              {repayLoading && <div className="flex justify-center items-center h-12">
                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
              </div>}
              {repayLoading ? "Repaying..." : "Confirm Repay"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Borrow;
