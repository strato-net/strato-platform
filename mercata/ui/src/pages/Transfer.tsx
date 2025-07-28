import { useEffect, useState, useCallback } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Token } from "@/interface";

import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { formatUnits, isAddress } from "ethers";
import { useTokenContext } from "@/context/TokenContext";
import { useToast } from "@/hooks/use-toast";
import { usdstAddress, TRANSFER_FEE } from "@/lib/constants";
import TransferConfirmationModal from "../components/TransferConfirmationModal";
import { safeParseUnits, safeParseFloat, roundToDecimals, addCommasToInput, formatBalance } from "@/utils/numberUtils";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";

const Transfer = () => {
  const { userAddress } = useUser();
  const { usdstBalance, fetchUsdstBalance, loadingUsdstBalance } = useUserTokens();
  const { getUserTokensWithBalance, transferToken } = useTokenContext();
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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState("")

  const maxAmount = fromAsset ? BigInt(fromAsset.balance) : 0n;

  const fetchUserTokens = useCallback(async () => {
    try {
      const tokens = await getUserTokensWithBalance();
      setTokens(tokens);
      return tokens;
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
      return [];
    }
  }, [getUserTokensWithBalance]);

  // Fetch USDST balance when user changes
  useEffect(() => {
    if (userAddress) {
      fetchUserTokens();
      fetchUsdstBalance(userAddress);
    }
  }, [userAddress, fetchUserTokens, fetchUsdstBalance]);

  const handleTransferClick = () => {
    if (!fromAsset || !recipient || !fromAmount || wrongAmount) return;
    
    // Check if amount is valid (not 0, not just ".", and is a valid number)
    const isValidAmount = fromAmount && 
                         fromAmount !== "." && 
                         /^\d*\.?\d+$/.test(fromAmount) && 
                         safeParseFloat(fromAmount) > 0;
    
    if (!isValidAmount) return;
    
    setShowConfirmModal(true);
  };

  const handleConfirmTransfer = async () => {
    if (!fromAsset || !recipient || !fromAmount) return;
    try {
      setSwapLoading(true);
      setShowConfirmModal(false);
      await transferToken({
        address: fromAsset.address,
        to: recipient,
        value: safeParseUnits(fromAmount, 18).toString(),
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
      const updatedToken = updatedTokens.find((t: Token) => t.address === fromAsset?.address);      
      if (updatedToken) {
        setFromAsset(updatedToken); // triggers re-render with updated balance
      } else {
        setFromAsset(null)
      }
      // Refresh USDST balance since gas fees were paid
      if (userAddress) {
        await fetchUsdstBalance(userAddress);
      }
    } catch (error) {
      // Error handling is now done globally by axios interceptor
      console.error("Transfer error:", error);
    } finally {
      setSwapLoading(false);
    }
  };

  const handleRecipientAddress = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    setRecipient(value);

    if (!value) {
      setErrorMessage(""); // Clear error if input is empty
    } else if (!isAddress(value)) {
      setErrorMessage("Invalid address");
    } else if (value.toLowerCase() === userAddress.toLowerCase()) {
      setErrorMessage("You cannot transfer to your own address.");
    } else {
      setErrorMessage(""); // Clear error if input is valid and not self
    }
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
              <Input
                type="text"
                value={recipient}
                onChange={handleRecipientAddress}
                placeholder="..."
                className="w-full p-2 border rounded"
              />
              {errorMessage && <span className="text-red-600 text-sm">{errorMessage}</span>}
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
                        try {
                          let max = maxAmount;
                          const feeAmount = safeParseUnits(TRANSFER_FEE, 18);

                          // If transferring USDST, subtract the fee
                          if (fromAsset?.address === usdstAddress) {
                            max = max > feeAmount ? max - feeAmount : 0n;
                          }

                          const raw = formatUnits(max, 18);
                          // clamp to 18 decimals using utility function
                          const clampedAmount = roundToDecimals(raw, 18);
                          setFromAmount(clampedAmount);
                        } catch (error) {
                          console.error("Error setting max amount:", error);
                        }
                      }}
                      className="font-medium text-blue-600 hover:underline focus:outline-none"
                    >
                      Max: {formatBalance(maxAmount, undefined, 18, 0, 4)}
                    </button>
                    {")"}</>
                )}
              </label>
              <Input
                type="text"
                inputMode="decimal"
                value={addCommasToInput(fromAmount)}
                onChange={(e) => {
                  const value = e.target.value;
                  // Strip commas for validation
                  const v = value.replace(/,/g, "");
                  
                  // Only allow valid decimal input
                  if (v === '' || /^\d*\.?\d*$/.test(v)) {
                    // Handle the case where user types just "."
                    if (v === '.') {
                      setFromAmount('0.');
                      setWrongAmount(false);
                    } else {
                      // Preserve trailing decimal point if user just typed it
                      let processedValue = v;
                      if (!v.endsWith('.')) {
                        // Only use roundToDecimals if there's no trailing decimal
                        processedValue = roundToDecimals(v, 18);
                      }
                      setFromAmount(processedValue);
                      
                      // Only parse if we have a valid number (not just "." or empty)
                      if (processedValue && processedValue !== "." && /^\d*\.?\d+$/.test(processedValue)) {
                        const inputWei = safeParseUnits(processedValue, 18);
                        setWrongAmount(inputWei <= 0n || inputWei > maxAmount);
                      } else {
                        setWrongAmount(false);
                      }
                    }
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
                const feeAmount = safeParseUnits(TRANSFER_FEE, 18);
                const usdstBalanceBigInt = BigInt(usdstBalance || "0");
                const inputAmountWei = fromAmount && fromAmount !== "." && /^\d*\.?\d+$/.test(fromAmount) ? safeParseUnits(fromAmount, 18) : 0n;

                // Check if transferring USDST and leaving enough for fee
                const isUsdstMaxIssue = !loadingUsdstBalance && fromAsset?.address === usdstAddress &&
                  inputAmountWei > usdstBalanceBigInt - feeAmount &&
                  inputAmountWei <= usdstBalanceBigInt;

                // Check if insufficient USDST for fee
                const isInsufficientUsdstForFee = !loadingUsdstBalance && fromAsset?.address !== usdstAddress &&
                  usdstBalanceBigInt < feeAmount;
                
                // Check if input amount is within 0.10 of USDST balance (low balance warning)
                const lowBalanceThreshold = safeParseUnits("0.10", 18);
                const remainingBalance = usdstBalanceBigInt - inputAmountWei - feeAmount;
                const isLowBalanceWarning = fromAsset?.address === usdstAddress &&
                  inputAmountWei > 0n &&
                  remainingBalance >= 0n &&
                  remainingBalance <= lowBalanceThreshold;

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
                    {isLowBalanceWarning && (
                      <p className="text-yellow-600 text-sm mt-1">
                        Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
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
              className="w-full"
              onClick={handleTransferClick}
              disabled={
                !fromAsset ||
                !recipient ||
                !fromAmount ||
                wrongAmount ||
                swapLoading ||
                !!errorMessage ||
                // Check if amount is invalid (just ".", or not a valid number, or 0)
                (fromAmount === "." || !/^\d*\.?\d+$/.test(fromAmount) || safeParseFloat(fromAmount) === 0) ||
                (() => {
                  const feeAmount = safeParseUnits(TRANSFER_FEE, 18);
                  const usdstBalanceBigInt = BigInt(usdstBalance || "0");

                  // Check if user has enough USDST for fee
                  if (usdstBalanceBigInt < feeAmount) {
                    return true;
                  }

                  // Check if transferring USDST and leaving enough for fee
                  if (fromAsset?.address === usdstAddress) {
                    const fromAmountWei = fromAmount && fromAmount !== "." && /^\d*\.?\d+$/.test(fromAmount) ? safeParseUnits(fromAmount, 18) : 0n;
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

          <TransferConfirmationModal
            open={showConfirmModal}
            onOpenChange={setShowConfirmModal}
            fromAsset={fromAsset}
            fromAmount={fromAmount}
            recipient={recipient}
            swapLoading={swapLoading}
            onConfirm={handleConfirmTransfer}
          />
        </main>
      </div>
    </div>
  );
};

export default Transfer;
