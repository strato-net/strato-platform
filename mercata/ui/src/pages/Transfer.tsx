import { useEffect, useState, useCallback, useMemo } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Token } from "@/interface";

import { useUser } from "@/context/UserContext";
import { useTokenContext, BulkTransferItem, BulkTransferResponse } from "@/context/TokenContext";
import { useToast } from "@/hooks/use-toast";
import { usdstAddress, TRANSFER_FEE } from "@/lib/constants";
import TransferConfirmationModal from "../components/TransferConfirmationModal";
import BulkTransferModal from "../components/BulkTransferModal";
import { safeParseUnits, roundToDecimals, addCommasToInput, formatBalance, formatUnits } from "@/utils/numberUtils";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronDown, Upload } from "lucide-react";
import { handleRecipientAddress, handleAmountInputChange, computeMaxTransferable } from "@/utils/transferValidation";
import { sortTokensCompareFn } from "@/lib/tokenPriority";

const Transfer = () => {
  const { userAddress } = useUser();
  const { usdstBalance, voucherBalance, fetchUsdstBalance, loadingUsdstBalance, getTransferableTokens, transferToken, bulkTransferToken } = useTokenContext();
  const { toast } = useToast();

  useEffect(() => {
    document.title = "Transfer Assets | STRATO";
  }, []);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [recipient, setRecipient] = useState<string>("");

  const [fromAsset, setFromAsset] = useState<Token>();
  const [fromAmount, setFromAmount] = useState("");
  const [swapLoading, setSwapLoading] = useState<boolean>(false);
  const [amountError, setAmountError] = useState("");
  const [tokenPopoverOpen, setTokenPopoverOpen] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showBulkTransferModal, setShowBulkTransferModal] = useState(false);
  const [recipientError, setRecipientError] = useState("");
  const [feeError, setFeeError] = useState("");
  const [showInactiveTokens, setShowInactiveTokens] = useState(false);

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
    try {
      const tokens = await getTransferableTokens();
      setTokens(tokens);
      return tokens;
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
      return [];
    }
  }, [getTransferableTokens]);

  // Sort and separate tokens with configurable priority order
  const { activeTokens, inactiveTokens } = useMemo(() => {
    const active = tokens.filter(token => token.token?.status === '2');
    const inactive = tokens.filter(token => token.token?.status !== '2');

    active.sort(sortTokensCompareFn);
    inactive.sort(sortTokensCompareFn);

    return { activeTokens: active, inactiveTokens: inactive };
  }, [tokens]);

  // Fetch USDST balance on mount
  useEffect(() => {
    fetchUserTokens();
    fetchUsdstBalance();
  }, [fetchUserTokens, fetchUsdstBalance]);

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
      await fetchUsdstBalance();
    } catch (error) {
      // Error handling is now done globally by axios interceptor
      console.error("Transfer error:", error);
    } finally {
      setSwapLoading(false);
    }
  };

  const handleBulkTransferConfirm = async (transfers: BulkTransferItem[]): Promise<BulkTransferResponse> => {
    if (!fromAsset) throw new Error("No token selected");

    const response = await bulkTransferToken({
      address: fromAsset.address,
      transfers,
    });

    // Show toast with results
    toast({
      title: "Bulk Transfer Complete",
      description: `${response.successCount} successful, ${response.failureCount} failed`,
    });

    // Refresh token balances
    const updatedTokens = await fetchUserTokens();
    const updatedToken = updatedTokens.find((t: Token) => t.address === fromAsset?.address);
    if (updatedToken) {
      setFromAsset(updatedToken);
    } else {
      setFromAsset(undefined);
    }

    // Refresh USDST balance since gas fees were paid
    await fetchUsdstBalance();

    return response;
  };

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Transfer" />
        <main className="p-4 md:p-6">
          <div className="max-w-2xl mx-auto bg-card shadow-md rounded-lg p-6 space-y-6 border border-border">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Transfer your tokens</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkTransferModal(true)}
                disabled={!fromAsset}
                title={!fromAsset ? "Select a token first" : "Upload CSV for bulk transfer"}
              >
                <Upload className="h-4 w-4 mr-2" />
                Bulk Transfer
              </Button>
            </div>

            {/* Token selector */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Token</label>
              <Popover
                open={tokenPopoverOpen}
                onOpenChange={(open) => {
                  setTokenPopoverOpen(open);
                  if (!open) setShowInactiveTokens(false); // Reset when closing
                }}
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
                      <>
                        {/* Active tokens */}
                        {activeTokens.map((token) => (
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
                              token?.token?._name}
                          </Button>
                        ))}
                        
                        {/* Show More button if there are inactive tokens */}
                        {inactiveTokens.length > 0 && !showInactiveTokens && (
                          <Button
                            variant="ghost"
                            className="justify-center text-muted-foreground hover:text-foreground border-t"
                            onClick={() => setShowInactiveTokens(true)}
                          >
                            Show More ({inactiveTokens.length})
                          </Button>
                        )}
                        
                        {/* Inactive tokens (shown when expanded) */}
                        {showInactiveTokens && inactiveTokens.map((token) => (
                          <Button
                            key={token.address}
                            variant="ghost"
                            className="justify-start text-muted-foreground"
                            onClick={() => {
                              setFromAsset(token);
                              setFromAmount("");
                              setTokenPopoverOpen(false);
                            }}
                          >
                            {token?.token?._symbol ||
                              token?.token?._name}
                          </Button>
                        ))}
                        
                        {/* Show Less button */}
                        {showInactiveTokens && inactiveTokens.length > 0 && (
                          <Button
                            variant="ghost"
                            className="justify-center text-muted-foreground hover:text-foreground border-t"
                            onClick={() => setShowInactiveTokens(false)}
                          >
                            Show Less
                          </Button>
                        )}
                      </>
                    ) : (
                      <span className="p-2 text-sm text-muted-foreground">
                        No tokens available
                      </span>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Recipient Address */}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Recipient Address</label>
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
              <label className="text-sm text-muted-foreground">
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
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Transaction Fee</span>
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

          <BulkTransferModal
            open={showBulkTransferModal}
            onOpenChange={setShowBulkTransferModal}
            fromAsset={fromAsset}
            userAddress={userAddress}
            maxBalance={maxAmount}
            onConfirm={handleBulkTransferConfirm}
          />
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Transfer;
