import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { Modal } from "antd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccount, useChainId } from "wagmi";
import { useBridgeContext } from "@/context/BridgeContext";
import PercentageButtons from "@/components/ui/PercentageButtons";
import { roundToDecimals, safeParseUnits, formatBalance } from "@/utils/numberUtils";
import { getNetworkErrorMessage, getTokenSelectionErrorMessage } from "@/utils/networkUtils";
import BridgeWalletStatus from "./BridgeWalletStatus";

interface Token {
  stratoTokenAddress: string;
  stratoTokenName: string;
  stratoTokenSymbol: string;
  chainId: string;
  enabled: boolean;
  extName: string;
  extToken: string;
  extSymbol: string;
  extDecimals: string;
}

interface BridgeOutProps {
  showTestnet: boolean;
  networkChainId: string | null;
}

const BridgeOut: React.FC<BridgeOutProps> = ({ showTestnet, networkChainId }) => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { toast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    loading: contextLoading,
    bridgeOut: bridgeOutAPI,
    getBalance,
    getBridgeableTokens,
  } = useBridgeContext();

  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [amountError, setAmountError] = useState<string>("");
  const [fromChain, setFromChain] = useState<string>("STRATO");
  const [toChain, setToChain] = useState<string>(showTestnet ? "Sepolia" : "Ethereum");
  const [bridgeOutTokens, setBridgeOutTokens] = useState<Token[]>([]);

  // Expected network validation - use chainId from bridgeInTokens API response
  // BridgeOut should validate against the same network as BridgeIn
  // For BridgeOut, user can bridge out from STRATO regardless of current network
  // No need to force them to be on a specific network
  const isCorrectNetwork = true; // Always allow bridge out operations
  
 

  // Fetch network tokens
  useEffect(() => {
    const loadBridgeOutTokens = async () => {
      try {
        // Use the networkChainId prop passed from BridgeWidget
        if (!networkChainId) {
          console.log("No networkChainId available yet");
          return;
        }
        
        console.log("Using networkChainId from props:", networkChainId);
        
        // Fetch bridgeable tokens with the networkChainId from props
        const tokens = await getBridgeableTokens(networkChainId);
        setBridgeOutTokens(tokens);
        
        if (!selectedToken && tokens.length > 0) {
          setSelectedToken(tokens[0]);
        }
        
      } catch (error) {
        console.error('Error fetching bridge out tokens:', error);
      }
    };

    loadBridgeOutTokens();
  }, [getBridgeableTokens, networkChainId]);

  // Network validation - following existing error handling pattern
  // Removed since BridgeOut doesn't require specific network connection
  // useEffect(() => {
  //   if (isConnected && chainId && expectedChainId) {
  //     if (chainId !== expectedChainId) {
  //       setNetworkError(getNetworkErrorMessage({
  //         networkName: expectedNetworkName,
  //         tokenSymbol: selectedToken?.stratoTokenSymbol || "tokens",
  //         direction: "out"
  //       }));
  //     } else {
  //       setNetworkError("");
  //     }
  //   } else if (isConnected && !selectedToken) {
  //     setNetworkError(getTokenSelectionErrorMessage("out"));
  //   } else {
  //     setNetworkError("");
  //   }
  // }, [chainId, isConnected, selectedToken, expectedChainId, expectedNetworkName]);


  // Balance update effect
  useEffect(() => {
    let mounted = true;
    let isInitialFetch = true;

    const updateBalance = async () => {
      try {
        if (isInitialFetch) {
          setIsBalanceLoading(true);
          setTokenBalance("0");
        }

        if (selectedToken?.stratoTokenAddress ) {
          const balanceData = await getBalance(selectedToken.stratoTokenAddress);

          if (mounted && balanceData?.balance) {
            const formattedBalance = formatBalance(
              balanceData.balance,
              undefined,
              parseInt(selectedToken.extDecimals)
            );
            setTokenBalance(formattedBalance);
          }
        }
      } catch (error) {
        console.error("Error fetching balance:", error);
        if (mounted) {
          setTokenBalance("0");
        }
      } finally {
        if (mounted) {
          setIsBalanceLoading(false);
          isInitialFetch = false;
        }
      }
    };

    if (isInitialFetch) {
      updateBalance();
    } else {
      const timeout = setTimeout(updateBalance, 1000);
      return () => clearTimeout(timeout);
    }

    return () => {
      mounted = false;
    };
  }, [ selectedToken, getBalance]);

  const validateAmount = (value: string): boolean => {
    if (!value) {
      setAmountError("");
      return true;
    }

    const numericAmount = parseFloat(value);
    const numericBalance = parseFloat(tokenBalance);

    if (isNaN(numericAmount)) {
      setAmountError("Please enter a valid number");
      return false;
    }

    if (numericAmount <= 0) {
      setAmountError("Amount must be greater than 0");
      return false;
    }

    if (numericAmount > numericBalance) {
      setAmountError(
        `Insufficient balance. Maximum amount: ${tokenBalance} ${selectedToken?.stratoTokenSymbol}`
      );
      return false;
    }

    setAmountError("");
    return true;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      setAmount(value);
      validateAmount(value);
    }
  };

  const handlePercentageClick = (percentageAmount: string) => {
    setAmount(percentageAmount);
    validateAmount(percentageAmount);
  };

  const showConfirmModal = () => {
    // Network validation - following existing error handling pattern
    if (!isCorrectNetwork) {
      toast({
        title: "Wrong Network",
        description: "Network validation is not required for bridge out operations",
        variant: "destructive",
      });
      return;
    }

    if (!selectedToken?.stratoTokenAddress || !address) {
      toast({
        title: "Error",
        description: "Invalid configuration",
        variant: "destructive",
      });
      return;
    }
    setIsModalOpen(true);
  };

  const handleModalCancel = () => {
    setIsModalOpen(false);
  };

  const handleBridgeOut = async () => {
    // Network validation - following existing error handling pattern
    if (!isCorrectNetwork) {
      toast({
        title: "Wrong Network",
        description: "Network validation is not required for bridge out operations",
        variant: "destructive",
      });
      setIsModalOpen(false);
      return;
    }

    setIsModalOpen(false);
    setIsLoading(true);
    toast({
      title: "Preparing transaction...",
      description: "Please wait while we prepare your transaction",
    });

    try {
      // Round amount to token's decimal places before sending
      
      // Convert amount to smallest unit (10^18 format)
      const amountInSmallestUnit = Math.floor(parseFloat(amount) * Math.pow(10, 18)).toString();
      
      console.log("Debug - networkChainId:", networkChainId);
      console.log("Debug - networkChainId type:", typeof networkChainId);
      console.log("Debug - destChainId being sent:", String(networkChainId));
      console.log("Debug - amount conversion:", `${amount} -> ${amountInSmallestUnit}`);
      
      const response = await bridgeOutAPI({
        amount: amountInSmallestUnit, // Send amount in smallest unit (10^18 format)
        destAddress: address, // Changed from toAddress to destAddress
        token: selectedToken.stratoTokenAddress,
        destChainId: String(networkChainId), // Ensure it's a string
      });

      if (response?.success) {
        toast({
          title: "Transaction Proposed Successfully",
           description: `Your tokens have been burned and ${amount} ${selectedToken?.stratoTokenSymbol} will be transferred to ${address}. Withdrawal is pending approval. Please wait for some time.`,
        });

        // Refresh balance after successful transaction
        const balanceData = await getBalance(selectedToken.stratoTokenAddress);
        if (balanceData?.balance) {
          const formattedBalance = formatBalance(
            balanceData.balance,
            undefined,
            parseInt(selectedToken.extDecimals)
          );
          setTokenBalance(formattedBalance);
        }
      } else {
        throw new Error("Failed to initiate transfer");
      }
    } catch (error) {
      console.error("Bridge transaction failed:", error);
      // Error toast is now handled globally by fetch wrapper
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <BridgeWalletStatus />
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="from">From Network</Label>
          <Input
            id="from-chain"
            value={fromChain}
            disabled
            className="bg-gray-50"
          />
        </div>

        <div className="flex-1 space-y-1.5">
          <Label htmlFor="to">To Network</Label>
          <Input
            id="to-chain"
            value={toChain}
            disabled
            className="bg-gray-50"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="asset">Select Asset</Label>
        <Select
          value={selectedToken?.stratoTokenSymbol || ""}
          onValueChange={(value) => {
            const token = bridgeOutTokens.find((t) => t.stratoTokenSymbol === value);
            if (token) {
              setSelectedToken(token);
            }
          }}
        >
          <SelectTrigger id="from-token">
            <SelectValue>
              {selectedToken
                ? `${selectedToken.stratoTokenName} (${selectedToken.stratoTokenSymbol})`
                : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {bridgeOutTokens.map((token) => (
              <SelectItem key={token.stratoTokenSymbol} value={token.stratoTokenSymbol}>
                {token.stratoTokenName} ({token.stratoTokenSymbol})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          type="text"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          placeholder="0.00"
          className={`w-full ${
            amountError ? "border-red-500 focus:ring-red-400" : ""
          }`}
          value={amount}
          onChange={handleAmountChange}
        />
        {amountError && (
          <p className="text-sm text-red-500">{amountError}</p>
        )}
        <PercentageButtons
          value={amount}
          maxValue={safeParseUnits(tokenBalance,18).toString()}
          onChange={handlePercentageClick}
          className="mt-2"
        />
        {amount && selectedToken && (
          <p className="text-sm text-gray-500">
            Amount will be rounded down to {selectedToken.extDecimals} decimal places
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {isBalanceLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <p className="text-sm text-gray-500">
                Fetching balance...
              </p>
            </div>
          ) : (
            tokenBalance && (
              <div className="space-y-2">
                <div className="text-sm text-gray-500">
                  Balance: {tokenBalance} {selectedToken?.stratoTokenSymbol}
                </div>
                {selectedToken?.extSymbol && (
                  <div className="text-sm">
                    <p className="bg-blue-50 p-2 rounded-md border border-blue-100">
                      You will receive {amount ? `${selectedToken ? roundToDecimals(amount, parseInt(selectedToken.extDecimals)) : amount} ` : ''} {selectedToken?.extName} ({selectedToken?.extSymbol}) on {toChain} network
                    </p>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>

      <div className="bg-gray-50 p-4 rounded-md space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Bridge Fee:</span>
          <span>0.1%</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Estimated Time:</span>
          <span>2-5 minutes</span>
        </div>
      </div>

      <div className="text-sm text-gray-500">
        <p>• Bridge assets between STRATO and {toChain} networks</p>
        <p>• Small bridge fee applies</p>
        <p>• Transaction time varies by network congestion</p>
      </div>

      <div className="flex justify-end gap-4">
        <Button
          onClick={showConfirmModal}
          disabled={Boolean(isLoading || !amount || !selectedToken || !isConnected || amountError || !isCorrectNetwork)}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading ? "Processing..." : "Bridge Assets"}
        </Button>
      </div>
      {!isConnected && (
        <div className="text-center">
          <p className="text-sm text-red-500">
            Connect your wallet to bridge assets. Use the wallet where you'd like to receive funds.
          </p>
        </div>
      )}

      <Modal
        title="Confirm Bridge Transaction"
        open={isModalOpen}
        onOk={handleBridgeOut}
        onCancel={handleModalCancel}
        okText="Yes, Bridge Assets"
        cancelText="Cancel"
      >
        <div className="space-y-4">
          <p>Are you sure you want to bridge your assets?</p>
          <div className="bg-gray-50 p-4 rounded-md">
            <p className="font-medium">Transaction Details:</p>
            <div className="mt-2 space-y-2">
              <p>From: {fromChain}</p>
              <p>To: {toChain}</p>
              <p>Amount: {selectedToken ? roundToDecimals(amount, parseInt(selectedToken.extDecimals)) : amount} {selectedToken?.stratoTokenSymbol}</p>
              {selectedToken?.extSymbol && (
                <p className="text-blue-600">
                  You will receive {selectedToken ? roundToDecimals(amount, parseInt(selectedToken.extDecimals)) : amount} {selectedToken?.extName} ({selectedToken?.extSymbol}) on {toChain} network
                </p>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default BridgeOut;
