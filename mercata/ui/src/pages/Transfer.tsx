import { useEffect, useState, useCallback } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Button } from "@/components/ui/button";
import { Token } from "@/interface";
import {api} from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { parseUnits, formatUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { usdstAddress, TRANSFER_FEE } from "@/lib/contants";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";

const Transfer = () => {
  const { userAddress } = useUser();
  const { usdstBalance, fetchUsdstBalance } = useUserTokens();
  const { toast } = useToast();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  useEffect(() => {
    document.title = "Transfer Assets | STRATO Mercata";
  }, []);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [recipient, setRecipient] = useState<string>("");

  const [fromAsset, setFromAsset] = useState<Token>();
  const [fromAmount, setFromAmount] = useState("");
  const [swapLoading, setSwapLoading] = useState<boolean>(false);
  const [wrongAmount, setWrongAmount] = useState(false);
  const [tokenPopoverOpen, setTokenPopoverOpen] = useState(false);

  const maxAmount = fromAsset ? BigInt(fromAsset.balance) : 0n;

  const fetchUserTokens = useCallback(async () => {
    try {
      const res = await api.get(`/tokens/balance?value=gt.0`);
      setTokens(res.data);
      return res.data;
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
      return [];
    }
  }, [userAddress]);

  // Fetch USDST balance when user changes
  useEffect(() => {
    if (userAddress) {
      fetchUserTokens();
      fetchUsdstBalance(userAddress);
    }
  }, [userAddress, fetchUserTokens, fetchUsdstBalance]);

  const handleTransfer = async () => {
    if (!fromAsset || !recipient || !fromAmount) return;
    try {
      setSwapLoading(true);
      await api.post("/tokens/transfer", {
        address: fromAsset.address,
        to: recipient,
        value: parseUnits(fromAmount, 18).toString(),
      });
      toast({
        title: "Success",
        description: `Transferred ${fromAmount} ${
          fromAsset?.token?._symbol ||
          fromAsset?.token?._name
          } to ${recipient}`,
      });
      setFromAmount("");
      setRecipient("");
      const updatedTokens = await fetchUserTokens();
      const updatedToken = updatedTokens.find(t => t.address === fromAsset?.address);
      if (updatedToken) {
        setFromAsset(updatedToken); // triggers re-render with updated balance
      }
    } catch (error) {
      const errorMessage = error?.response?.data?.error?.message || error?.message || "An unexpected error occurred during transfer";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSwapLoading(false);
    }
  };

  const addCommasToInput = (value: string) => {
    if (!value) return '';
    const parts = value.split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    if (parts.length === 2) {
      return integerPart + '.' + parts[1];
    }
    return integerPart;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Transfer Assets" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <main className="p-6">
          <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 space-y-6">
            <h2 className="text-xl font-semibold">Transfer your tokens</h2>

            {/* Token selector */}
            <div className="space-y-2">
              <label className="text-sm text-gray-600">Token</label>
              <Popover
                open={tokenPopoverOpen}
                onOpenChange={setTokenPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full flex justify-between items-center"
                  >
                    <span>
                      {fromAsset
                        ? fromAsset?.token?._symbol ||
                        fromAsset?.token?._name
                        : "Select Token"}
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <div className="flex flex-col max-h-72 overflow-y-auto">
                    {tokens.length > 0 ? (
                      tokens.map((token) => (
                        <Button
                          key={token.address}
                          variant="ghost"
                          className="justify-start"
                          onClick={() => {
                            setFromAsset(token);
                            setFromAmount("");
                            setTokenPopoverOpen(false);
                          }}
                        >
                          {token?.token?._symbol ||
                            fromAsset?.token?._name}
                        </Button>
                      ))
                    ) : (
                      <span className="p-2 text-sm text-gray-500">
                        No tokens available
                      </span>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Recipient Address */}
            <div className="space-y-2">
              <label className="text-sm text-gray-600">Recipient Address</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="..."
                className="w-full p-2 border rounded"
              />
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="text-sm text-gray-600">
                Amount
                {fromAsset && (
                  <>{" ("}
                    <button
                      type="button"
                      onClick={() => {
                        let raw = formatUnits(maxAmount, 18);    // e.g. "12.3456789012345678901"
                        // clamp to 18 decimals
                        const [w, f = ""] = raw.split(".");
                        if (f.length > 18) raw = `${w}.${f.slice(0, 18)}`;
                        setFromAmount(raw);
                      }}
                      className="font-medium text-blue-600 hover:underline focus:outline-none"
                    >
                      Max: {Number(formatUnits(maxAmount, 18)).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 4,
                      })}
                    </button>
                    {")"}</>
                )}
              </label>
              <input
                type="text"
                inputMode="decimal"
                pattern="^\\d*(\\.\\d*)?$"
                value={addCommasToInput(fromAmount)}
                onChange={(e) => {
                  // 1. Strip commas
                  let v = e.target.value.replace(/,/g, "");
                  if (!/^\d*\.?\d*$/.test(v)) return;
                  // 2. Clamp to 18 decimals
                  const [whole, frac = ""] = v.split(".");
                  if (frac.length > 18) v = `${whole}.${frac.slice(0, 18)}`;
                  setFromAmount(v);
                  if (v) {
                    const inputWei = parseUnits(v, 18);
                    setWrongAmount(inputWei <= 0n || inputWei > maxAmount);
                  } else {
                    setWrongAmount(false);
                  }
                }}
                placeholder="0.00"
                className={`w-full p-2 border rounded ${wrongAmount ? "border-red-500" : ""
                  }`}
              />
              {wrongAmount && (
                <p className="text-red-600 text-sm">
                  Amount must be greater than zero and no more than your
                  available balance.
                </p>
              )}
              {/* Fee validation warnings */}
              {(() => {
                const feeAmount = parseUnits(TRANSFER_FEE, 18);
                const usdstBalanceBigInt = BigInt(usdstBalance || "0");
                const inputAmountWei = fromAmount ? parseUnits(fromAmount, 18) : 0n;

                // Check if transferring USDST and leaving enough for fee
                const isUsdstMaxIssue = fromAsset?.address === usdstAddress &&
                  inputAmountWei > usdstBalanceBigInt - feeAmount &&
                  inputAmountWei <= usdstBalanceBigInt;

                // Check if insufficient USDST for fee
                const isInsufficientUsdstForFee = fromAsset?.address !== usdstAddress &&
                  usdstBalanceBigInt < feeAmount;

                return (
                  <>
                    {isUsdstMaxIssue && (
                      <p className="text-yellow-600 text-sm mt-1">
                        Insufficient balance for transaction fee ({TRANSFER_FEE} USDST)
                      </p>
                    )}
                    {isInsufficientUsdstForFee && (
                      <p className="text-yellow-600 text-sm mt-1">
                        Insufficient USDST balance for transaction fee ({TRANSFER_FEE} USDST)
                      </p>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Transaction Fee Display */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Transaction Fee</span>
                <span className="font-medium">{TRANSFER_FEE} USDST</span>
              </div>
            </div>

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              onClick={handleTransfer}
              disabled={
                !fromAsset ||
                !recipient ||
                !fromAmount ||
                wrongAmount ||
                swapLoading ||
                (() => {
                  const feeAmount = parseUnits(TRANSFER_FEE, 18);
                  const usdstBalanceBigInt = BigInt(usdstBalance || "0");

                  // Check if user has enough USDST for fee
                  if (usdstBalanceBigInt < feeAmount) {
                    return true;
                  }

                  // Check if transferring USDST and leaving enough for fee
                  if (fromAsset?.address === usdstAddress) {
                    const fromAmountWei = fromAmount ? parseUnits(fromAmount, 18) : 0n;
                    const balance = BigInt(fromAsset.balance || "0");

                    if (fromAmountWei > balance - feeAmount && fromAmountWei <= balance) {
                      return true;
                    }
                  }

                  return false;
                })()
              }
            >
              {swapLoading ? <span>Processing…</span> : "Transfer"}
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Transfer;
