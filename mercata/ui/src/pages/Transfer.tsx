import { useEffect, useState, useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import TransferConfirmationModal from "../components/TransferConfirmationModal";

import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { useToast } from "@/hooks/use-toast";

import { Token } from "@/interface";
import { TRANSFER_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatBalance, formatWeiAmount } from "@/utils/numberUtils";
import { handleRecipientAddress, handleAmountInputChange, computeMaxTransferable } from "@/utils/validationUtils";

const Transfer = () => {
  // Hooks
  const { userAddress } = useUser();
  const { fetchUsdstBalance, loadingUsdstBalance } = useUserTokens();
  const { getUserTokensWithBalance, transferToken, loading: tokenLoading } = useTokenContext();
  const { usdstBalance, voucherBalance } = useUserTokens();
  const { toast } = useToast();

  // State
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selectedToken, setSelectedToken] = useState<Token>();
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState<string>("");
  const [recipientError, setRecipientError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [transferLoading, setTransferLoading] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Computed values
  const maxAmount = selectedToken ? BigInt(selectedToken.balance) : 0n;
  const maxTransferable = useMemo(() => {
    return selectedToken ? computeMaxTransferable(maxAmount, selectedToken.address, TRANSFER_FEE, BigInt(voucherBalance), BigInt(usdstBalance)) : 0n;
  }, [selectedToken, maxAmount, voucherBalance, usdstBalance]);
  const isLoading = loadingUsdstBalance || tokenLoading;
  const isDisabled = 
    isLoading ||
    !selectedToken ||
    !recipient ||
    !amount ||
    transferLoading ||
    !!recipientError ||
    !!amountError;

  // Functions
  const fetchAllData = useCallback(async () => {
    if (!userAddress) return [];
    
    const [tokens] = await Promise.all([
      getUserTokensWithBalance(),
      fetchUsdstBalance(userAddress)
    ]);
    
    setTokens(tokens);
    return tokens;
  }, [userAddress, getUserTokensWithBalance, fetchUsdstBalance]);

  // Effects
  useEffect(() => {
    document.title = "Transfer Assets | STRATO Mercata";
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleConfirmTransfer = async () => {
    if (isDisabled) return;
    
    setTransferLoading(true);
    setShowConfirmModal(false);
    
    await transferToken({
      address: selectedToken.address,
      to: recipient,
      value: safeParseUnits(amount, 18).toString(),
    });
    
    toast({
      title: "Success",
      description: `Transferred ${amount} ${
        selectedToken?.token?._symbol ||
        selectedToken?.token?._name
        } to ${recipient}`,
    });
    
    setAmount("");
    setRecipient("");
    setRecipientError("");
    setAmountError("");
    
    const updatedTokens = await fetchAllData();
    const updatedToken = updatedTokens.find((t: Token) => t.address === selectedToken?.address);      
    if (updatedToken && BigInt(updatedToken.balance) > 0n) {
      setSelectedToken(updatedToken);
    } else {
      setSelectedToken(null);
    }
    
    setTransferLoading(false);
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
              <Select
                value={selectedToken?.address || ""}
                onValueChange={(value) => {
                  const token = tokens.find(t => t.address === value);
                  if (token) {
                    setSelectedToken(token);
                    setAmount("");
                    setRecipientError("");
                    setAmountError("");
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select Token" />
                </SelectTrigger>
                <SelectContent>
                  {tokens.map((token) => (
                    <SelectItem key={token.address} value={token.address}>
                      {token?.token?._symbol || token?.token?._name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                {selectedToken && (
                  <>{" ("}
                    <button
                      type="button"
                      onClick={() => {
                        const maxFormatted = formatWeiAmount(maxTransferable.toString());
                        setAmount(maxFormatted);
                        setAmountError("");
                      }}
                      className="font-medium text-blue-600 hover:underline focus:outline-none"
                    >
                      Max: {formatBalance(maxTransferable, undefined, 18, 0, 4)}
                    </button>
                    {")"}</>
                )}
              </label>
              <Input
                type="text"
                inputMode="decimal"
                value={addCommasToInput(amount)}
                onChange={(e) => {
                  const value = e.target.value;
                  handleAmountInputChange(
                    value,
                    setAmount,
                    setAmountError,
                    {
                      maxAmount,
                      symbol: selectedToken?.token?._symbol || "",
                      tokenAddress: selectedToken?.address,
                      transactionFee: TRANSFER_FEE,
                      voucherBalance: BigInt(voucherBalance),
                      usdstBalance: BigInt(usdstBalance)
                    }
                  );
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
            </div>

            {/* Transaction Fee Display */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Transaction Fee</span>
                <span className="font-medium">{TRANSFER_FEE} USDST ({parseFloat(TRANSFER_FEE) * 100} vouchers)</span>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => setShowConfirmModal(true)}
              disabled={isDisabled}
            >
              {isLoading ? <span>Loading…</span> : transferLoading ? <span>Processing…</span> : "Transfer"}
            </Button>
          </div>

          <TransferConfirmationModal
            open={showConfirmModal}
            onOpenChange={setShowConfirmModal}
            selectedToken={selectedToken}
            amount={amount}
            recipient={recipient}
            transferLoading={transferLoading}
            onConfirm={handleConfirmTransfer}
          />
        </main>
      </div>
    </div>
  );
};

export default Transfer;
