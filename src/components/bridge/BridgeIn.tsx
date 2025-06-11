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
import {
  useAccount,
  useChainId,
  useBalance,
  useSendTransaction,
  useWriteContract,
} from "wagmi";
import { parseEther, createPublicClient, http, parseUnits } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { NATIVE_TOKEN_ADDRESS, SAFE_ADDRESS } from "@/lib/bridge/constants";

interface Token {
  name: string;
  symbol: string;
  tokenAddress: string;
  decimals: number;
  icon: string;
  chainId: number;
}

interface BridgeInProps {
  showTestnet: boolean;
}

const formatBalance = (value: bigint, decimals: number): string => {
  const formattedBalance = Number(value) / Math.pow(10, decimals);
  return formattedBalance.toFixed(decimals);
};

const BRIDGE_API = {
  bridgeIn: async (params: {
    amount: string;
    fromAddress: string;
    tokenAddress: string;
    ethHash: string;
  }) => {
    try {
      const response = await fetch(`/api/bridge/bridgeIn`, {
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

      return responseData.data;
    } catch (error: any) {
      console.error("Bridge API error:", error);
      throw error;
    }
  },
  bridgeInTokens: async () => {
    const response = await fetch(`/api/bridgeNetworkTokens/bridgeIn`);
    const responseData = await response.json();
    return responseData.data.data.networkTokens;
  }
};

const BridgeIn: React.FC<BridgeInProps> = ({ showTestnet }) => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { toast } = useToast();

  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [bridgeInTokens, setBridgeInTokens] = useState<Token[]>([]);
  const [amountError, setAmountError] = useState<string>("");
  const [fromChain, setFromChain] = useState<string>(showTestnet ? "Sepolia" : "Ethereum");
  const [toChain, setToChain] = useState<string>("STRATO");

  // Fetch network tokens
  useEffect(() => {
    const fetchBridgeInTokens = async () => {
      try {
        const tokens = await BRIDGE_API.bridgeInTokens();
        setBridgeInTokens(tokens);
        if (!selectedToken && tokens.length > 0) {
          setSelectedToken(tokens[0]);
        }
      } catch (error) {
        console.error('Error fetching bridge in tokens:', error);
      }
    };

    fetchBridgeInTokens();
  }, []);

  // Balance fetching hooks
  const { data: nativeBalance, refetch: refetchNativeBalance } = useBalance({
    address,
    chainId: selectedToken?.chainId,
    query: {
      enabled:
        isConnected &&
        !!address &&
        !!selectedToken?.chainId &&
        selectedToken?.symbol === (showTestnet ? "SepoliaETH" : "ETH"),
      refetchInterval: false,
    },
  });

  const { data: tokenBalanceData, refetch: refetchTokenBalance } = useBalance({
    address,
    token: selectedToken?.tokenAddress as `0x${string}` | undefined,
    chainId: selectedToken?.chainId,
    query: {
      enabled:
        isConnected &&
        !!address &&
        !!selectedToken?.chainId &&
        !!selectedToken &&
        selectedToken.symbol !== (showTestnet ? "SepoliaETH" : "ETH"),
      refetchInterval: false,
    },
  });

  // Network validation
  useEffect(() => {
    if (isConnected && chainId && selectedToken?.chainId) {
      if (chainId !== selectedToken.chainId) {
        toast({
          title: "Wrong Network",
          description: `Please switch to the correct network for ${selectedToken.name}`,
          variant: "destructive",
        });
      }
    }
  }, [chainId, isConnected, selectedToken, toast]);

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

        if (selectedToken?.symbol === (showTestnet ? "SepoliaETH" : "ETH")) {
          if (nativeBalance) {
            const formattedBalance = formatBalance(
              nativeBalance.value,
              nativeBalance.decimals
            );
            if (mounted) {
              setTokenBalance(formattedBalance);
            }
          }
        } else if (selectedToken?.tokenAddress) {
          if (tokenBalanceData) {
            const formattedBalance = formatBalance(
              tokenBalanceData.value,
              tokenBalanceData.decimals
            );
            if (mounted) {
              setTokenBalance(formattedBalance);
            }
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
  }, [
    isConnected,
    address,
    selectedToken,
    nativeBalance,
    tokenBalanceData,
    chainId,
  ]);

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
        `Insufficient balance. Maximum amount: ${tokenBalance} ${selectedToken?.symbol}`
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

  const handleBridgeIn = async () => {
    const tokenAddress = selectedToken?.tokenAddress;
    const tokenChainId = selectedToken?.chainId;

    if (!tokenChainId) {
      toast({
        title: "Error",
        description: "Invalid network configuration",
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
      let hash: `0x${string}` | undefined;

      if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
        const txHash = await sendTransactionAsync({
          to: SAFE_ADDRESS as `0x${string}`,
          value: parseEther(amount),
        });
        hash = txHash as `0x${string}`;
      } else {
        const txHash = await writeContractAsync({
          address: tokenAddress as `0x${string}`,
          abi: [
            {
              name: "transfer",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "recipient", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              outputs: [{ name: "", type: "bool" }],
            },
          ],
          functionName: "transfer",
          args: [SAFE_ADDRESS as `0x${string}`, parseUnits(amount, 6)],
          chain: showTestnet ? sepolia : mainnet,
          account: address as `0x${string}`,
        });
        hash = txHash as `0x${string}`;
      }

      await BRIDGE_API.bridgeIn({
        amount,
        fromAddress: address as string,
        tokenAddress: tokenAddress || "",
        ethHash: hash,
      });

      const client = createPublicClient({
        chain: showTestnet ? sepolia : mainnet,
        transport: http(),
      });
      
      const receipt = await client.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        
        if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
          const balance = await client.getBalance({
            address: address as `0x${string}`,
          });
          const formattedBalance = formatBalance(balance, 18);
          setTokenBalance(formattedBalance);
        } else {
          const balance = await client.readContract({
            address: tokenAddress as `0x${string}`,
            abi: [
              {
                name: "balanceOf",
                type: "function",
                stateMutability: "view",
                inputs: [{ name: "account", type: "address" }],
                outputs: [{ name: "", type: "uint256" }],
              },
            ],
            functionName: "balanceOf",
            args: [address as `0x${string}`],
          });
          const formattedBalance = formatBalance(balance, 6);
          setTokenBalance(formattedBalance);
        }

        toast({
          title: "Transaction Successful",
          description: `Successfully bridged ${amount} ${selectedToken?.symbol}`,
        });
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
              {showTestnet ? (
                <SelectItem value="Sepolia">Sepolia</SelectItem>
              ) : (
                <SelectItem value="Ethereum">Ethereum</SelectItem>
              )}
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
              <SelectItem value="STRATO">STRATO</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="asset">Select Asset</Label>
        <Select
          value={selectedToken?.symbol || ""}
          onValueChange={(value) => {
            const token = bridgeInTokens.find((t) => t.symbol === value);
            if (token) {
              setSelectedToken(token);
            }
          }}
        >
          <SelectTrigger id="from-token">
            <SelectValue>
              {selectedToken
                ? `${selectedToken.name} (${selectedToken.symbol})`
                : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {bridgeInTokens.map((token) => (
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
        />
        {amountError && (
          <p className="text-sm text-red-500">{amountError}</p>
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
              <p className="text-sm text-gray-500">
                Balance: {tokenBalance} {selectedToken?.symbol}
              </p>
            )
          )}
        </div>
      </div>

      <div className="flex justify-end gap-4">
        <Button
          onClick={handleBridgeIn}
          disabled={Boolean(
            isLoading || !amount || !selectedToken || !isConnected
          )}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading ? "Processing..." : "Bridge Assets"}
        </Button>
      </div>
    </div>
  );
};

export default BridgeIn; 
