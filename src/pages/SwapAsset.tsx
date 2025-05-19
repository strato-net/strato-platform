import { useEffect, useMemo, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowDownUp, Check, ChevronDown } from "lucide-react";
import { SwappableToken } from "@/interface";
import api from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from "@/context/SwapContext";

const SwapAsset = () => {
  // const { tokens: swappableTokens } = useSwapableTokens();
  // const { pairableTokens, fetchForToken } = usePairableSwapTokens();
  const { swappableTokens, pairableTokens, fetchPairableTokens } = useSwapContext();

  const { userAddress } = useUser();
  const { toast } = useToast();
  useEffect(() => {
    document.title = "Swap Assets | STRATO Mercata";
  }, []);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [fromAsset, setFromAsset] = useState<SwappableToken>();
  const [toAsset, setToAsset] = useState<SwappableToken>();
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [wrongAmount, setWrongAmount] = useState(false);
  const [fromPopoverOpen, setFromPopoverOpen] = useState(false);
  const [toPopoverOpen, setToPopoverOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslit/no-explicit-any
  const [pool, setPool] = useState<any>(null);
  const [exchangeRate, setExchangeRate] = useState<number>(0);
  const [fromBalanceLoading, setFromBalanceLoading] = useState<boolean>(false);
  const [toBalanceLoading, setToBalanceLoading] = useState<boolean>(false);
  const [swapLoading, setSwapLoading] = useState<boolean>(false);

  useEffect(() => {
    if (fromAsset?.address) {
      fetchPairableTokens(fromAsset.address);
    }
  }, [fromAsset?.address, fetchPairableTokens]);

  const handleSwapAssets = () => {
    const temp = fromAsset;
    setFromAsset(toAsset);
    setToAsset(temp);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  const handleAmountChange = (isFromInput: boolean, value: string) => {
    if (
      !fromAsset ||
      !toAsset ||
      !fromAsset.address ||
      !toAsset.address ||
      !pool?.data
    ) {
      if (isFromInput) setFromAmount(value);
      else setToAmount(value);
      return;
    }

    try {
      const decimals = 18; // adjust if your tokens use different decimals
      const inputValue = value === "" ? "0" : value;

      const parsedValue = parseUnits(inputValue, decimals);
      const fromBalance = parseUnits(fromAsset.balance || "0", decimals);

      if (isFromInput) {
        setFromAmount(value);

        setWrongAmount(parsedValue > fromBalance);

        const ratio =
          pool.data.tokenA === fromAsset.address
            ? pool.data.aToBRatio
            : pool.data.bToARatio;

        const result =
          (parsedValue * BigInt(Math.floor((ratio || 0) * 1e6))) / BigInt(1e6);
        const formatted = parseFloat(formatUnits(result, decimals)).toFixed(6);

        setToAmount(formatted);
      } else {
        setToAmount(value);

        const ratio =
          pool.data.tokenA === toAsset.address
            ? pool.data.aToBRatio
            : pool.data.bToARatio;

        const result =
          (parsedValue * BigInt(Math.floor((ratio || 0) * 1e6))) / BigInt(1e6);
        const formatted = parseFloat(formatUnits(result, decimals)).toFixed(6);

        setFromAmount(formatted);
      }
    } catch (err) {
      console.error("Conversion error:", err);
    }
  };

  const handleSwap = async () => {
    if (!fromAsset || !toAsset) return;
    try {
      setSwapLoading(true);
      // Replace this with your actual pool address logic if different
      const method =
        pool.data.tokenA === fromAsset.address
          ? "tokenAToTokenB"
          : "tokenBToTokenA";

      const response = await api.post("/swap/swap", {
        address: pool.address,
        method: method,
        amount: parseUnits(fromAmount || "0", 18).toString(),
        min_tokens: parseUnits(
          (parseFloat(toAmount || "0") * 0.99).toString(),
          18
        ).toString(),
      });
      toast({
        title: "Success",
        description: `Swap successful: ${fromAmount} ${fromAsset?._symbol || ""} to ${toAmount} ${toAsset?._symbol || ""}`,
        variant: "default",
      });
      setIsDialogOpen(false);
      setSwapLoading(false);
      setFromAmount('');
      setToAmount('');
      getTokenBalance(fromAsset, true)
      getTokenBalance(toAsset)
    } catch (error) {
      console.error("Swap error:", error);
       toast({
        title: "Error",
        description: "Swap failed. Please try again.",
        variant: "destructive",
      });
      setIsDialogOpen(false);
      setSwapLoading(false);
    }
  };

  const getTokenBalance = async (asset: SwappableToken, from = false) => {
    try {
      const setAsset = from ? setFromAsset : setToAsset;
      const setLoading = from ? setFromBalanceLoading : setToBalanceLoading;
      setLoading(true);
      setAsset(asset);

      // Fetch balance
      const res = await api.get(
        `/tokens/table/balance?key=eq.${userAddress}&address=eq.${asset?.address}`
      );

      const balance = res?.data?.[0]?.value || "0";

      // Update asset with balance
      setAsset((prev) => ({ ...prev, ...asset, balance }));
      setLoading(false);
    } catch (err) {
      console.log(err);
      from ? setFromBalanceLoading(false) : setToBalanceLoading(false);
    }
  };

  useEffect(() => {
    if (fromAsset && fromAsset.address && toAsset && toAsset.address) {
      getPoolByTokenPair(fromAsset.address, toAsset.address);
    }
  }, [fromAsset, toAsset]);

  const getPoolByTokenPair = async (tokenA: string, tokenB: string) => {
    try {
      const res = await api.get(
        `/poolByTokenPair?tokenPair=${tokenA},${tokenB}`
      );
      setPool(res.data[0]);
      return res.data[0];
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    if (!pool || !fromAsset || !toAsset) return;

    const rate =
      pool?.data?.tokenA === fromAsset?.address
        ? pool?.data?.aToBRatio
        : pool?.data?.bToARatio;
    setExchangeRate(Number(rate) || 0);
  }, [pool, fromAsset, toAsset]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />

      <div className="flex-1 ml-64">
        <DashboardHeader title="Swap Assets" />

        <main className="p-6">
          <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-6">
              Exchange your digital assets
            </h2>

            <div className="space-y-6">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-600">From</label>
                  <span className="text-sm text-gray-600">
                    Balance:{" "}
                    {fromBalanceLoading ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                    ) : (
                      `${Number(
                        formatUnits(fromAsset?.balance || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 4,
                      })} ${fromAsset?._symbol || ""}`
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between flex-1">
                  <div className="flex flex-col">
                    <input
                      type="number"
                      value={fromAmount}
                      onChange={(e) => handleAmountChange(true, e.target.value)}
                      placeholder="0.00"
                      className={`p-2 bg-transparent border-none text-lg font-medium focus:outline-none
      ${wrongAmount ? "border border-red-500 rounded-md" : ""}`}
                    />
                    {wrongAmount && (
                      <p className="text-red-600 text-sm mt-1">
                        Insufficient balance
                      </p>
                    )}
                  </div>

                  <Popover
                    open={fromPopoverOpen}
                    onOpenChange={setFromPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="flex items-center gap-2"
                      >
                        {/* <span className="font-mono">{fromAsset.icon}</span> */}
                        <span>{fromAsset?._symbol || "Select Token"}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-0">
                      <div className="flex flex-col">
                        {swappableTokens.length > 0 ? (
                          swappableTokens.map((asset) => (
                            <Button
                              key={asset?._symbol || ""}
                              variant="ghost"
                              className="justify-start gap-2"
                              onClick={() => {
                                setFromPopoverOpen(false);
                                getTokenBalance(asset, true);
                              }}
                            >
                              {/* <span className="font-mono">{asset.icon}</span> */}
                              <span>{asset?._symbol || ""}</span>
                              {asset?._symbol === fromAsset?._symbol && (
                                <Check className="h-4 w-4 ml-auto" />
                              )}
                            </Button>
                          ))
                        ) : (
                          <span className="p-2">No data to show</span>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="flex justify-center">
                <Button
                  onClick={handleSwapAssets}
                  variant="outline"
                  size="icon"
                  className="rounded-full bg-gray-100"
                >
                  <ArrowDownUp className="h-4 w-4" />
                </Button>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-600">To</label>
                  <span className="text-sm text-gray-600">
                    Balance:{" "}
                    {toBalanceLoading ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                    ) : (
                      `${Number(
                        formatUnits(toAsset?.balance || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 4,
                      })} ${toAsset?._symbol || ""}`
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <input
                      type="number"
                      value={toAmount}
                      onChange={(e) =>
                        handleAmountChange(false, e.target.value)
                      }
                      placeholder="0.00"
                      className={`p-2 bg-transparent border-none text-lg font-medium focus:outline-none flex-1
      ${wrongAmount ? "border border-red-500 rounded-md" : ""}`}
                    />
                    {wrongAmount && (
                      <p className="text-red-600 text-sm mt-1">
                        Insufficient balance
                      </p>
                    )}
                  </div>

                  <Popover open={toPopoverOpen} onOpenChange={setToPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="flex items-center gap-2"
                      >
                        {/* <span className="font-mono">{toAsset.icon}</span> */}
                        <span>{toAsset?._symbol || "Select Token"}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-0">
                      <div className="flex flex-col">
                        {pairableTokens.length > 0 ? (
                          pairableTokens.map((asset) => (
                            <Button
                              key={asset?._symbol || ""}
                              variant="ghost"
                              className="justify-start gap-2"
                              onClick={() => {
                                setToPopoverOpen(false);
                                getTokenBalance(asset);
                              }}
                            >
                              {/* <span className="font-mono">{asset.icon}</span> */}
                              <span>{asset?._symbol || ""}</span>
                              {asset?._symbol === toAsset?._symbol && (
                                <Check className="h-4 w-4 ml-auto" />
                              )}
                            </Button>
                          ))
                        ) : (
                          <span className="p-2">No data to show</span>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="flex flex-col gap-2 bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Exchange Rate</span>
                  <span className="font-medium">
                    1 {fromAsset?._symbol || ""} ≈{" "}
                    {exchangeRate.toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 4,
                    })}{" "}
                    {toAsset?._symbol || ""}
                  </span>
                </div>
              </div>

              <Button
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={() => setIsDialogOpen(true)}
                disabled={
                  !fromAmount ||
                  !toAmount ||
                  !fromAsset ||
                  !toAsset ||
                  wrongAmount
                }
              >
                Swap Assets
              </Button>
            </div>
          </div>
        </main>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Swap</DialogTitle>
            <DialogDescription>
              Please review your transaction details before confirming.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="flex justify-between">
              <span className="text-gray-600">You pay:</span>
              <span className="font-semibold">
                {fromAmount} {fromAsset?._symbol || ""}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">You receive:</span>
              <span className="font-semibold">
                {toAmount} {toAsset?._symbol || ""}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Exchange rate:</span>
              <span>
                1 {fromAsset?._symbol || ""} ≈ {exchangeRate}{" "}
                {toAsset?._symbol || ""}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={swapLoading} onClick={handleSwap}>
              {swapLoading && (
                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
              )}{" "}
              Confirm Swap
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SwapAsset;
