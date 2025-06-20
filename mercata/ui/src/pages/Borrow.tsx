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
      await fetchLoans();
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
      setWrongAmount(parseUnits(value === "" ? "0" : value, 18) > BigInt(loan?.loan?.amount, 18))
    }
  };

  const fetchLoans = useCallback(async () => {
    const userData = JSON.parse(localStorage.getItem("user") || "{}");
    const addr = userData.userAddress;
    try {
      const userLoans = Object.entries(loans)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map(([loanId, loan]: [string, any]) => ({ loanId, ...loan }))
        .filter((loan: any) => loan?.loan?.user === addr && loan?.loan?.active === true);
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
  }, []);

useEffect(() => {
    if (Object.keys(loans || {}).length > 0) {
      fetchLoans();
  }
  }, [loans, fetchLoans]);

  const repayLoan = async () => {
    try {
      setRepayLoading(true);
      const amountInWei = parseUnits(repayAmount, 18).toString();
      const response = await repayLoanFn({
        loanId: loan?.key,
        amount: amountInWei,
        asset: loan?.loan?.asset,
      });
      console.log(response, "repay loan response");
      setRepayLoading(false);
      setShowRepayModal(false)
      api["success"]({
        message: "Success",
        description: `Successfully Repaid ${repayAmount} ${loan?._symbol}`,
      });
      await refreshLoans();
      await fetchLoans();
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
                    <TableHead>Action</TableHead>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white text-xs font-bold">
                US
              </div>
              Repay USDST Loan
            </DialogTitle>
          </DialogHeader>
          
          {loan && (
            <>
              <div className="space-y-2 py-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Original Loan Amount</span>
                  <span className="font-medium">${formatUnits(loan?.loan?.amount || 0, 18)}</span>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Accrued Interest</span>
                  <span className="font-medium">${formatUnits(loan?.loan?.interest || 0, 18)}</span>
                </div>
                
                <div className="flex justify-between items-center font-bold pt-2 border-t">
                  <span>Total Amount Due</span>
                  <span className="text-lg">${loan?.balanceHuman}</span>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium">Repay Amount (USDST)</label>
                <div className="relative">
                  <Input
                    placeholder={loan?.balanceHuman}
                    className=""
                    value={repayAmount}
                    onChange={handleAmountChange}
                  />
                  {wrongAmount && (
                    <p className="text-red-600 text-sm mt-1">
                      Insufficient balance
                    </p>
                  )}
                </div>
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Min: $0.01</span>
                  <span>Max: ${loan?.balanceHuman}</span>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    variant={repayAmount === loan?.balanceHuman ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRepayAmount(loan?.balanceHuman)}
                    className="flex-1"
                  >
                    100%
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRepayAmount((parseFloat(loan?.balanceHuman) * 0.5).toFixed(2))}
                    className="flex-1"
                  >
                    50%
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRepayAmount((parseFloat(loan?.balanceHuman) * 0.25).toFixed(2))}
                    className="flex-1"
                  >
                    25%
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRepayAmount((parseFloat(loan?.balanceHuman) * 0.1).toFixed(2))}
                    className="flex-1"
                  >
                    10%
                  </Button>
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Payment Amount</span>
                  <span className="font-medium">${repayAmount || "0.00"}</span>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Remaining Balance</span>
                  <span className="font-medium">
                    ${repayAmount ? (parseFloat(loan?.balanceHuman) - parseFloat(repayAmount)).toFixed(2) : loan?.balanceHuman}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3 bg-gray-50 rounded-md text-sm">
                <p className="text-gray-600">
                  Repaying your loan will reduce your debt and may free up collateral. Full repayment will close the loan and unlock all collateral.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowRepayModal(false)}
                  className="mr-2"
                >
                  Cancel
                </Button>
                <Button
                  onClick={repayLoan}
                  disabled={
                    repayLoading ||
                    !repayAmount ||
                    isNaN(Number(repayAmount)) ||
                    Number(repayAmount) <= 0 ||
                    Number(repayAmount) > Number(loan?.balanceHuman || 0)
                  }
                  className="px-6"
                >
                  {repayLoading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
                  ) : (
                    `Repay $${repayAmount || "0.00"}`
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Borrow;
