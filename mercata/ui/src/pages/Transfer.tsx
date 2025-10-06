import { useEffect, useState, useCallback, useMemo } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Token } from "@/interface";

import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { useToast } from "@/hooks/use-toast";
import { usdstAddress, TRANSFER_FEE } from "@/lib/constants";
import TransferConfirmationModal from "../components/TransferConfirmationModal";
import { safeParseUnits, roundToDecimals, addCommasToInput, formatBalance, formatUnits } from "@/utils/numberUtils";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";
import { handleRecipientAddress, handleAmountInputChange, computeMaxTransferable } from "@/utils/transferValidation";

const Transfer = () => {
  const { userAddress } = useUser();
  const { usdstBalance, voucherBalance, fetchUsdstBalance, loadingUsdstBalance } = useUserTokens();
  const { getTransferableTokens, transferToken } = useTokenContext();
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
  const [amountError, setAmountError] = useState("");
  const [tokenPopoverOpen, setTokenPopoverOpen] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [recipientError, setRecipientError] = useState("");
  const [feeError, setFeeError] = useState("");

  const maxAmount = useMemo(() => {
    if (!fromAsset) return "0";
    return computeMaxTransferable(
      fromAsset.balance,
      fromAsset.address === usdstAddress,
      voucherBalance,
      usdstBalance,
      safeParseUnits(TRANSFER_FEE, 18).toString(),
      setFeeError
    );
  }, [fromAsset, voucherBalance, usdstBalance]);

  const fetchUserTokens = useCallback(async () => {
    console.log("fetchUserTokens");
    try {
      const tokens = await getTransferableTokens();
      setTokens(tokens);
      return tokens;
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
      return [];
    }
  }, [getTransferableTokens]);

  // Fetch USDST balance when user changes
  useEffect(() => {
    if (userAddress) {
      fetchUserTokens();
      fetchUsdstBalance(userAddress);
    }
  }, [userAddress, fetchUserTokens, fetchUsdstBalance]);

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
                onChange={(e) => handleRecipientAddress(e, setRecipient, setRecipientError, userAddress)}
                placeholder="..."
                className="w-full p-2 border rounded"
              />
              {recipientError && <span className="text-red-600 text-sm">{recipientError}</span>}
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
                          const raw = formatUnits(maxAmount);
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
                  handleAmountInputChange(e.target.value, setFromAmount, setAmountError, maxAmount, 18);
                }}
                placeholder="0.00"
                className={`w-full p-2 border rounded ${amountError ? "border-red-500" : ""
                  }`}
              />
              {amountError && (
                <p className="text-red-600 text-sm">
                  {amountError}
                </p>
              )}
              {feeError && (
                <p className="text-red-600 text-sm">
                  {feeError}
                </p>
              )}
            </div>

            {/* Transaction Fee Display */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Transaction Fee</span>
                <span className="font-medium">
                  {TRANSFER_FEE} USDST ({parseFloat(TRANSFER_FEE) * 100} voucher)
                </span>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => setShowConfirmModal(true)}
              disabled={
                !fromAsset ||
                !recipient ||
                !fromAmount ||
                !!amountError ||
                !!recipientError ||
                !!feeError ||
                swapLoading
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
