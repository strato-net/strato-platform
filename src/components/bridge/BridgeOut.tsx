import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccount } from "wagmi";

interface Token {
  name: string;
  symbol: string;
  tokenAddress: string;
  decimals: number;
  icon: string;
  chainId: number;
}

interface BridgeOutProps {
  showTestnet: boolean;
}

const BRIDGE_API = {
  bridgeOut: async (params: {
    amount: string;
    toAddress: string;
    tokenAddress: string;
  }) => {
    try {
      const response = await fetch(`/api/bridge/bridgeOut`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(responseData.error || "Bridge transaction failed");
      }

      return responseData;
    } catch (error: any) {
      console.error("Bridge API error:", error);
      throw error;
    }
  },

  getBalance: async (params: { tokenAddress: string }) => {
    const response = await fetch(`/api/bridge/balance/${params.tokenAddress}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const responseData = await response.json();
    return responseData.data;
  },
};

const BridgeOut: React.FC<BridgeOutProps> = ({ showTestnet }) => {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();

  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState("");
  const [stratoBalance, setStratoBalance] = useState<string>("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isStratoLoading, setIsStratoLoading] = useState(false);
  const [networkTokens, setNetworkTokens] = useState<Token[]>([]);
  const [amountError, setAmountError] = useState<string>("");
  const [balanceError, setBalanceError] = useState<string>("");
  const [fromChain, setFromChain] = useState<string>("STRATO");
  const [toChain, setToChain] = useState<string>(showTestnet ? "Sepolia" : "Ethereum");

  // Fetch network tokens
  useEffect(() => {
    const fetchNetworkTokens = async () => {
      try {
        const response = await fetch(`/api/bridgeNetworkTokens/bridgeOut`);
        const responseData = await response.json();
        const tokens = responseData.data.data.networkTokens;
        setNetworkTokens(tokens);
        
        if (!fromToken && tokens.length > 0) {
          setFromToken(tokens[0]);
        }
      } catch (error) {
        console.error('Error fetching network tokens:', error);
        setNetworkTokens([]);
      }
    };

    fetchNetworkTokens();
  }, []);

  // Fetch Strato balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (fromToken && address) {
        setIsStratoLoading(true);
        setStratoBalance("0");
        setBalanceError("");

        try {
          if (!fromToken.tokenAddress) {
            throw new Error("Invalid token address");
          }

          const formattedTokenAddress = fromToken.tokenAddress.startsWith('0x') 
            ? fromToken.tokenAddress 
            : `0x${fromToken.tokenAddress}`;

          const balanceData = await BRIDGE_API.getBalance({
            tokenAddress: formattedTokenAddress,
          });

          if (balanceData && balanceData.balance) {
            setIsStratoLoading(false);
            setStratoBalance(balanceData.balance);
          } else {
            throw new Error("No balance data received");
          }
        } catch (error) {
          console.error("Error fetching balance:", error);
          setIsStratoLoading(false);
          setStratoBalance("0");
          setBalanceError("Unable to fetch balance");
        }
      }
    };

    fetchBalance();
  }, [fromToken, address]);

  const validateAmount = (value: string): boolean => {
    if (!value) {
      setAmountError("");
      return true;
    }

    const numericAmount = parseFloat(value);
    const numericBalance = parseFloat(stratoBalance);

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
        `Insufficient balance. Maximum amount: ${Number(stratoBalance).toFixed(18)} ${fromToken?.symbol}`
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

  const handleBridgeOut = async () => {
    if (!fromToken?.tokenAddress || !address) {
      toast({
        title: "Error",
        description: "Invalid configuration",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    toast({
      title: "Preparing transaction...",
      description: "Please wait while we prepare your transaction",
    });

    try {
      const response = await BRIDGE_API.bridgeOut({
        amount: amount,
        toAddress: address,
        tokenAddress: fromToken.tokenAddress,
      });

      if (response?.data?.success && response?.data?.bridgeOutResponse?.status === "Success") {
        toast({
          title: "Transaction Proposed Successfully",
          description: "Your transaction has been proposed and is waiting for approval",
        });
      } else {
        throw new Error("Failed to initiate transfer");
      }
    } catch (error: any) {
      console.error("Bridge transaction failed:", error);
      toast({
        title: "Failed to initiate transfer",
        description: error.message || "Please try again later",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="from">From Network</Label>
          <Select
            value={fromChain}
            onValueChange={(value) => setFromChain(value)}
          >
            <SelectTrigger id="from-chain">
              <SelectValue placeholder="Select network">
                {fromChain || "Select network"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="STRATO">STRATO</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 space-y-1.5">
          <Label htmlFor="to">To Network</Label>
          <Select
            value={toChain}
            onValueChange={(value) => setToChain(value)}
          >
            <SelectTrigger id="to-chain">
              <SelectValue placeholder="Select network">
                {toChain || "Select network"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {showTestnet ? (
                <SelectItem value="Sepolia">Sepolia</SelectItem>
              ) : (
                <SelectItem value="Ethereum">Ethereum</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="asset">Select Asset</Label>
        <Select
          value={fromToken?.symbol || ""}
          onValueChange={(value) => {
            const token = networkTokens.find((t) => t.symbol === value);
            if (token) {
              setFromToken(token);
            }
          }}
        >
          <SelectTrigger id="from-token">
            <SelectValue>
              {fromToken
                ? `${fromToken.name} (${fromToken.symbol})`
                : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {networkTokens.map((token) => (
              <SelectItem key={token.symbol} value={token.symbol}>
                {token.name} ({token.symbol})
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
          disabled={isStratoLoading || !stratoBalance}
        />
        {amountError && (
          <p className="text-sm text-red-500">{amountError}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {isStratoLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <p className="text-sm text-gray-500">
                Fetching balance...
              </p>
            </div>
          ) : balanceError ? (
            <p className="text-sm text-red-500">
              {balanceError}
            </p>
          ) : (
            stratoBalance && (
              <p className="text-sm text-gray-500">
                Balance: {stratoBalance} {fromToken?.symbol}
              </p>
            )
          )}
        </div>
      </div>

      <div className="flex justify-end gap-4">
        <Button
          onClick={handleBridgeOut}
          disabled={Boolean(
            isLoading || !amount || !fromToken || !isConnected
          )}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading ? "Processing..." : "Bridge Assets"}
        </Button>
      </div>
    </div>
  );
};

export default BridgeOut; 