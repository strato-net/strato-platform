import { useEffect, useState, useMemo } from "react";
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

  const { toast } = useToast();
  const {
    depositableTokens,
    refreshDepositTokens,
    loadingDepositTokens,
    loans,
    refreshLoans,
    loadingLoans,
  } = useLendingContext();

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

      await api.post("/lend/getLoan", {
        asset: borrowAsset?.address,
        amount: amountInWei,
        collateralAsset: asset?.address,
        collateralAmount: collateralInWei,
      });

      toast({
        title: "Borrow Initiated",
        description: `You borrowed ${amount} USDT against your ${asset._name}.`,
        variant: "success",
      });

      setBorrowLoading(false);
      setIsBorrowModalOpen(false);
      refreshDepositTokens();
      refreshLoans();
    } catch (error: any) {
      console.log(error, "error");
      setBorrowLoading(false);
      setIsBorrowModalOpen(false);
      toast({
        title: "Borrow Error",
        description: `Something went wrong - ${
          error?.message || "Please try again later."
          }`,
        variant: "destructive",
      });
    }
  };

  const activeLoans = loans.filter((loan: Loan) => loan?.loan?.active);

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
              <CardTitle>Your loans</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Collateral</TableHead>
                    <TableHead>Accrued Interest</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingLoans ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <LoadingSpinner />
                      </TableCell>
                    </TableRow>
                  ) : activeLoans?.length > 0 ? (
                    activeLoans?.map((loan, loanIndex) => (
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
    </div>
  );
};

export default Borrow;
