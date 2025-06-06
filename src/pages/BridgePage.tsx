import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeftRight,
  ArrowDownUp,
  History,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBridge } from "@/lib/bridge/BridgeContext";
import {
  MAINNET_TOKENS,
  TESTNET_TOKENS,
  TOKEN_ADDRESSES,
  NETWORK_CONFIGS,
  SAFE_ADDRESS,
  NATIVE_TOKEN_ADDRESS,
  BRIDGE_TOKEN_ADDRESS_ETH,
  BRIDGE_TOKEN_ADDRESS_USDC,
} from "@/lib/bridge/constants";
import {
  useAccount,
  useDisconnect,
  useChainId,
  useBalance,
  useSendTransaction,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseEther, createPublicClient, http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { useNavigate } from "react-router-dom";

// Add utility function for formatting balance
const formatBalance = (value: bigint, decimals: number): string => {
  const formattedBalance = Number(value) / Math.pow(10, decimals);
  return formattedBalance.toFixed(decimals);
};

// API endpoint for bridge
const BRIDGE_API = {
  bridgeIn: async (params: {
    amount: string; // amount to bridge in with converted decimals
    fromAddress: string; // user wallet address
    tokenAddress: string; // strato token address
    ethHash: string; // hash of the transaction
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

  bridgeOut: async (params: {
    amount: string; // amount to bridge out with converted decimals
    toAddress: string; // user wallet address
    tokenAddress: string; // strato token address
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

const BridgePage = () => {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const {
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
    tokenBalance,
    isLoading,
    showTestnet,
    setFromChain,
    setToChain,
    setFromToken,
    setToToken,
    setAmount,
    setTokenBalance,
    swapChains,
  } = useBridge();

  // Filter tokens based on testnet status
  const availableTokens = showTestnet ? TESTNET_TOKENS : MAINNET_TOKENS;

  const { toast } = useToast();
  const navigate = useNavigate();
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [stratoBalance, setStratoBalance] = useState<string>("0");
  const [isStratoLoading, setIsStratoLoading] = useState(false);
  const [isTokenLoading, setIsTokenLoading] = useState(false);

  // Create debounced update function using useMemo
  const debouncedUpdateBalance = React.useMemo(() => {
    let timeout: NodeJS.Timeout;
    return (callback: () => void) => {
      clearTimeout(timeout);
      timeout = setTimeout(callback, 1000);
    };
  }, []);

  // Update balance fetching hooks with proper configuration
  const { data: nativeBalance, refetch: refetchNativeBalance } = useBalance({
    address,
    chainId: showTestnet ? 11155111 : 1,
    query: {
      enabled:
        isConnected &&
        !!address &&
        !!fromChain &&
        fromToken?.symbol === (showTestnet ? "SepoliaETH" : "ETH"),
      refetchInterval: false,
    },
  });

  const { data: tokenBalanceData, refetch: refetchTokenBalance } = useBalance({
    address,
    token: fromToken
      ? (TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol] as `0x${string}`)
      : undefined,
    chainId: NETWORK_CONFIGS[fromChain]?.chainId,
    query: {
      enabled:
        isConnected &&
        !!address &&
        !!fromChain &&
        !!fromToken &&
        fromToken.symbol !== (showTestnet ? "SepoliaETH" : "ETH"),
      refetchInterval: false,
    },
  });

  // Add effect to refetch balance when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      if (fromToken?.symbol === (showTestnet ? "SepoliaETH" : "ETH")) {
        refetchNativeBalance();
      } else {
        refetchTokenBalance();
      }
    }
  }, [
    isConnected,
    address,
    fromToken,
    refetchNativeBalance,
    refetchTokenBalance,
  ]);

  // Update the balance fetching effect
  useEffect(() => {
    let mounted = true;
    let isInitialFetch = true;

    const updateBalance = async () => {
      try {
        // Only show loading on initial fetch or network switch
        if (isInitialFetch) {
          setIsTokenLoading(true);
          setTokenBalance("0"); // Reset balance while loading
        }

        // Fetch balance based on token type
        if (fromToken.symbol === (showTestnet ? "SepoliaETH" : "ETH")) {
          if (nativeBalance) {
            const formattedBalance = formatBalance(
              nativeBalance.value,
              nativeBalance.decimals
            );
            if (mounted) {
              setTokenBalance(formattedBalance);
            }
          }
        } else {
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
          setIsTokenLoading(false);
          isInitialFetch = false;
        }
      }
    };

    // Only use debounce for subsequent updates, not initial fetch
    if (isInitialFetch) {
      updateBalance();
    } else {
      debouncedUpdateBalance(updateBalance);
    }

    // Cleanup function
    return () => {
      mounted = false;
    };
  }, [
    isConnected,
    address,
    fromToken,
    fromChain,
    nativeBalance,
    tokenBalanceData,
    chainId,
    debouncedUpdateBalance,
  ]);

  // Add amount validation
  const [amountError, setAmountError] = useState<string>("");

  const validateAmount = (value: string): boolean => {
    if (!value) {
      setAmountError("");
      return true;
    }

    const numericAmount = parseFloat(value);
    const numericBalance =
      fromChain === "STRATO"
        ? parseFloat(stratoBalance)
        : parseFloat(tokenBalance);

    if (isNaN(numericAmount)) {
      setAmountError("Please enter a valid number");
      return false;
    }

    if (numericAmount <= 0) {
      setAmountError("Amount must be greater than 0");
      return false;
    }

    if (numericAmount > numericBalance) {
      const displayBalance =
        fromChain === "STRATO"
          ? Number(stratoBalance).toFixed(18)
          : tokenBalance;

      setAmountError(
        `Insufficient balance. Maximum amount: ${displayBalance} ${
          fromChain === "STRATO" ? "STRATO" : fromToken?.symbol
        }`
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

  const ethToStratoTokenMapping = showTestnet
    ? {
        SepoliaETH: { name: "SepoliaETHST", symbol: "SepoliaETHST" },
        USDC: { name: "USDCST", symbol: "USDCST" },
      }
    : {
        ETH: { name: "ETHST", symbol: "ETHST" },
        USDC: { name: "USDCST", symbol: "USDCST" },
      };

  // Update available networks based on testnet status
  const availableNetworks = showTestnet
    ? ["Sepolia"] // Show both Sepolia and Ethereum in testnet mode
    : ["Ethereum"];

  // Set initial network and token
  useEffect(() => {
    if (!fromChain) {
      setFromChain(showTestnet ? "Sepolia" : "Ethereum");
    }
    if (!fromToken) {
      const defaultToken = showTestnet
        ? TESTNET_TOKENS.find((t) => t.symbol === "SepoliaETH")
        : MAINNET_TOKENS.find((t) => t.symbol === "ETH");
      if (defaultToken) {
        setFromToken(defaultToken);
        setToToken(ethToStratoTokenMapping[defaultToken.symbol]); // Set toToken to same as fromToken
      }
    }
  }, [showTestnet, fromChain, fromToken]);

  // Add effect to ensure toToken is always same as fromToken
  useEffect(() => {
    if (fromToken) {
      setToToken(fromToken);
    }
  }, [fromToken]);

  const mapping = {
    [NATIVE_TOKEN_ADDRESS]: BRIDGE_TOKEN_ADDRESS_ETH,
    [TOKEN_ADDRESSES["Sepolia"]?.["USDC"]]: BRIDGE_TOKEN_ADDRESS_USDC,
  };

  const handleBridgeSubmit = async () => {
    try {
      // For STRATO to other networks transfers, directly call the API
      if (fromChain === "STRATO" && toChain !== "STRATO") {
        // Show initial toast
        toast({
          title: "Transaction Submitted",
        });

        // Determine the correct bridge token address based on the selected token
        let bridgeTokenAddress;
        if (fromToken?.symbol === "SepoliaETH" || fromToken?.symbol === "ETH") {
          bridgeTokenAddress = BRIDGE_TOKEN_ADDRESS_ETH;
        } else if (fromToken?.symbol === "USDC") {
          bridgeTokenAddress = BRIDGE_TOKEN_ADDRESS_USDC;
        } else {
          throw new Error("Unsupported token for bridging");
        }
        // Call the STRATO to Ethereum transfer endpoint
        const response = await BRIDGE_API.bridgeOut({
          amount: amount.toString(),
          toAddress: address as string,
          tokenAddress: bridgeTokenAddress,
        });

      
        if (response?.data?.success && response?.data?.bridgeOutResponse?.status === "Success") {
          toast({
            title: "Transaction Proposed Successfully",
            description: "Your transaction has been proposed and is waiting for approval",
          });
        } else {
          toast({
            title: "Failed to initiate transfer",
            description: "Please try again later",
          });
          throw new Error("Failed to initiate transfer");
        }
        return;
      }

      // For other network transfers, use handleBridgeIn
      await handleBridgeIn();
    } catch (error: any) {
      console.error("Bridge transaction failed:", error);
      toast({
        title: "Failed to initiate transfer",
        description: "Please try again later",
      });
    }
  };

  const handleBridgeIn = async () => {
    const tokenAddress = TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol];

    toast({
      title: "Preparing transaction...",
      description: "Please wait while we prepare your transaction",
    });

    let hash: `0x${string}` | undefined;

    if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
      // Native token logic using wagmi's sendTransactionAsync
      const txHash = await sendTransactionAsync({
        to: SAFE_ADDRESS as `0x${string}`,
        value: parseEther(amount),
      });

      hash = txHash as `0x${string}`;
    } else {
      // ERC20 token logic using writeContractAsync
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
        args: [SAFE_ADDRESS as `0x${string}`, parseEther(amount)],
        chain: showTestnet ? sepolia : mainnet,
        account: address as `0x${string}`,
      });

      hash = txHash as `0x${string}`;
    }

    toast({
      title: "Transaction submitted",
      description: "Waiting for confirmation...",
    });

    // Call bridge API with transaction details
    await BRIDGE_API.bridgeIn({
      amount,
      fromAddress: address as string,
      tokenAddress: mapping[tokenAddress],
      ethHash: hash,
    });

    // Wait for transaction confirmation
    const client = createPublicClient({
      chain: showTestnet ? sepolia : mainnet,
      transport: http(),
    });
    
    const receipt = await client.waitForTransactionReceipt({ hash });

    if (receipt.status === "success") {
      // Refresh balance after successful transfer
      if (fromToken.symbol === (showTestnet ? "SepoliaETH" : "ETH")) {
        const balance = await client.getBalance({
          address: address as `0x${string}`,
        });
        const formattedBalance = formatBalance(balance, 18);

        // Force state update and UI refresh
        setTokenBalance("0"); // Reset first to trigger change
        setTimeout(() => {
          setTokenBalance(formattedBalance);
          // Show success toast with new balance
          toast({
            title: "Transaction Successful",
            description: `New balance: ${formattedBalance} ${fromToken.symbol}`,
          });
        }, 100);
      } else {
        // For ERC20 tokens, we need to read the contract
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
        const formattedBalance = formatBalance(balance, 18);

        // Force state update and UI refresh
        setTokenBalance("0"); // Reset first to trigger change
        setTimeout(() => {
          setTokenBalance(formattedBalance);
          // Show success toast with new balance
          toast({
            title: "Transaction Successful",
            description: `New balance: ${formattedBalance} ${fromToken.symbol}`,
          });
        }, 100);
      }
    }
  };

  const handleBack = () => {
    navigate(-1);
  };

  // Fetch Strato balance when fromChain is STRATO
  useEffect(() => {
    const fetchBalance = async () => {
      if (fromChain === "STRATO" && fromToken && address) {
        setIsStratoLoading(true);
        setStratoBalance("0");
        let tokenAddress;

        // Determine which bridge token address to use
        if (fromToken.symbol === "SepoliaETH" || fromToken.symbol === "ETH") {
          tokenAddress = BRIDGE_TOKEN_ADDRESS_ETH;
        } else if (
          fromToken.symbol === "USDCST" ||
          fromToken.symbol === "USDC"
        ) {
          tokenAddress = BRIDGE_TOKEN_ADDRESS_USDC;
        } else {
          tokenAddress = TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol];
        }


        if (!tokenAddress) {
          throw new Error("Invalid token address");
        }

        const balanceData = await BRIDGE_API.getBalance({
          tokenAddress,
        });

        if (balanceData && balanceData.balance) {
          setIsStratoLoading(false);
          setStratoBalance(balanceData.balance);
        } else {
          setIsStratoLoading(false);
          setStratoBalance("0");
        }
      }
    };

    // Call fetchBalance when dependencies change
    fetchBalance();
  }, [fromChain, fromToken, address, showTestnet]);

  return (
    <>
      {/* Back Button */}
      <div className="fixed top-4 left-4 z-50">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          className="rounded-full hover:bg-gray-100 w-10 h-10 border border-gray-200 shadow-sm"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </div>
      {/* Bridge */}
      <div className="min-h-screen bg-white">
        <div className="max-w-3xl mx-auto p-6">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-lg p-8">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="h-6 w-6 text-blue-600" />
                <h1 className="text-2xl font-semibold text-gray-900">
                  Bridge Assets
                </h1>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2"
                onClick={() => navigate("/dashboard/bridge-transactions")}
              >
                <History className="h-4 w-4" />
                View Transactions
              </Button>
            </div>

            <div className="grid gap-6">
              <div className="flex items-center">
                {isConnected ? (
                  <div
                    onClick={() => disconnect()}
                    className="relative group cursor-pointer"
                  >
                    <div className="px-4 py-2 bg-green-50 text-green-600 rounded-xl font-semibold group-hover:opacity-0 transition-opacity">
                      Wallet Connected
                    </div>
                    <div className="absolute inset-0 bg-red-50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-red-600 font-semibold">
                        Disconnect
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="[&>button]:bg-gradient-to-r [&>button]:from-[#1f1f5f] [&>button]:via-[#293b7d] [&>button]:to-[#16737d] [&>button]:text-white [&>button]:px-4 [&>button]:py-2 [&>button]:rounded-xl [&>button]:font-semibold [&>button]:hover:opacity-90 [&>button]:transition-all">
                    <ConnectButton label={"Connect Wallet"} />
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="space-y-6">
                  <div className="space-y-1.5">
                    <Label htmlFor="asset">Select Asset</Label>
                    <Select
                      value={fromToken?.symbol || ""}
                      onValueChange={(value) => {
                        const token = availableTokens.find(
                          (t) => t.symbol === value
                        );
                        if (token) {
                          setFromToken(token);
                          setToToken(ethToStratoTokenMapping[token.symbol]);
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
                        {availableTokens.map((token) => (
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
                      disabled={
                        fromChain === "STRATO" &&
                        (isStratoLoading || !stratoBalance)
                      }
                    />
                    {amountError && (
                      <p className="text-sm text-red-500">{amountError}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {isBalanceLoading || isStratoLoading || isTokenLoading ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                          <p className="text-sm text-gray-500">
                            Fetching balance...
                          </p>
                        </div>
                      ) : fromChain === "STRATO" ? (
                        stratoBalance && (
                          <p className="text-sm text-gray-500">
                            Balance: {Number(stratoBalance).toFixed(18)} STRATO{" "}
                            {fromToken?.symbol}
                          </p>
                        )
                      ) : (
                        tokenBalance && (
                          <p className="text-sm text-gray-500">
                            Balance: {tokenBalance} {fromToken?.symbol}
                          </p>
                        )
                      )}
                    </div>
                  </div>

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
                          {availableNetworks.map((network) => (
                            <SelectItem key={network} value={network}>
                              {network}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={swapChains}
                      className="rounded-full hover:bg-gray-100 border border-gray-200 shadow-sm mt-6"
                    >
                      <ArrowDownUp className="h-5 w-5 rotate-90" />
                    </Button>

                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor="to">To Network</Label>
                      <Select
                        value={toChain}
                        onValueChange={(value) => {
                          setToChain(value);
                        }}
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
                </div>
              </div>
              <div className="flex justify-end gap-4">
                <Button variant="outline" onClick={handleBack}>
                  Cancel
                </Button>
                <Button
                  onClick={handleBridgeSubmit}
                  disabled={Boolean(
                    isLoading || !amount || !fromToken || !isConnected
                  )}
                  className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
                >
                  {isLoading ? "Processing..." : "Bridge Assets"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default BridgePage;
