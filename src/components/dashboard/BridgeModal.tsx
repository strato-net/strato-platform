import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeftRight, ArrowDownUp, History, ArrowLeft, Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBridge } from '@/lib/bridge/BridgeContext';
import { 
  BRIDGEABLE_TOKENS, 
  TESTNET_TOKENS, 
  TOKEN_ADDRESSES, 
  NETWORK_CONFIGS,
  SAFE_ADDRESS,
  BRIDGE_CONTRACT_ADDRESS,
  BRIDGE_ABI,
  NATIVE_TOKEN_ADDRESS
} from '@/lib/bridge/constants';
import { useAccount, useDisconnect, useChainId, useSwitchChain, useBalance, useConnect, useSendTransaction, useWriteContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { parseEther, parseUnits, createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '@/components/ui/dialog';


const   BRIDGE_API_BASE_URL = import.meta.env.VITE_BRIDGE_API_BASE_URL;

const stringToHex = (str: string): string => {
  return Array.from(str)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
};

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateTransactionStatus?: (hash: string, status: string) => void;
}

// Add utility function for formatting balance
const formatBalance = (value: bigint, decimals: number): string => {
  const formattedBalance = Number(value) / Math.pow(10, decimals);
  return formattedBalance.toFixed(decimals);
};

const BridgeModal = ({ isOpen, onClose, updateTransactionStatus }: BridgeModalProps) => {
  const [isNetworkChanged, setIsNetworkChanged] = useState(false);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | undefined>();
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

  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  

  // Filter tokens based on testnet status
  const availableTokens = showTestnet 
    ? TESTNET_TOKENS
    : BRIDGEABLE_TOKENS;

  // Network validation based on selected network
  const isChainMatching = () => {
    if (!isConnected || !chainId || !fromChain) return false;
    
    const selectedNetworkChainId = NETWORK_CONFIGS[fromChain]?.chainId;
    const isMatching = chainId === selectedNetworkChainId;
    return isMatching;
  };

  // Network switching based on selected network
  const handleNetworkSwitch = async () => {
    try {
      setIsBalanceLoading(true);
      setTokenBalance("");
      
      const targetChainId = NETWORK_CONFIGS[fromChain]?.chainId;
      if (!targetChainId) {
        throw new Error('Invalid network selected');
      }

      await switchChain({ chainId: targetChainId });
    } catch (error) {
      console.error('Network switch error:', error);
      toast({
        title: "Network Switch Failed",
        description: `Please switch to ${fromChain} network in your wallet`,
        variant: "destructive",
      });
      setIsBalanceLoading(false);
    }
  };

  // Update balance fetching hooks with proper configuration
  const { data: nativeBalance, refetch: refetchNativeBalance } = useBalance({
    address,
    chainId: NETWORK_CONFIGS[fromChain]?.chainId,
    query: {
      enabled: isConnected && !!address && !!fromChain && fromToken?.symbol === (showTestnet ? 'SepoliaETH' : 'ETH') && isChainMatching(),
      refetchInterval: false
    }
  });

  const { data: tokenBalanceData, refetch: refetchTokenBalance } = useBalance({
    address,
    token: fromToken ? (TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol] as `0x${string}`) : undefined,
    chainId: NETWORK_CONFIGS[fromChain]?.chainId,
    query: {
      enabled: isConnected && !!address && !!fromChain && !!fromToken && fromToken.symbol !== (showTestnet ? 'SepoliaETH' : 'ETH') && isChainMatching(),
      refetchInterval: false
    }
  });
  const fetchUserBalance = async (userAddress: string) => {
    try {
      const response = await fetch(`${BRIDGE_API_BASE_URL}/api/safe/balance/${userAddress}`);
      const data = await response.json();
      if (data.success) {
        return data;
      } else {
        throw new Error(data.error || 'Failed to fetch balance');
      }
    } catch (error: any) {
      console.error('Error fetching user balance:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch balance",
        variant: "destructive",
      });
      return "0";
    }
  };

  // Add effect to refetch balance when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      if (fromToken?.symbol === (showTestnet ? 'SepoliaETH' : 'ETH')) {
        refetchNativeBalance();
      } else {
        refetchTokenBalance();
      }
    }
  }, [isConnected, address, fromToken, refetchNativeBalance, refetchTokenBalance]);

  // Update the balance fetching effect
  useEffect(() => {
    let mounted = true;
    let isInitialFetch = true;

    const updateBalance = async () => {
      if (!mounted) return;
      
      if (!isConnected || !address || !fromToken || !fromChain) {
        setTokenBalance("0");
        setIsBalanceLoading(false);
        return;
      }

      // Only fetch balance if we're on the correct network
      if (!isChainMatching()) {
        setTokenBalance("0");
        setIsBalanceLoading(false);
        return;
      }

      try {
        // Only show loading on initial fetch or network switch
        if (isInitialFetch) {
          setIsTokenLoading(true);
          setTokenBalance("0"); // Reset balance while loading
        }
        
        // Fetch balance based on token type
        if (fromToken.symbol === (showTestnet ? 'SepoliaETH' : 'ETH')) {
          if (nativeBalance) {
            const formattedBalance = formatBalance(nativeBalance.value, nativeBalance.decimals);
            if (mounted) {
              setTokenBalance(formattedBalance);
            }
          }
        } else {
          if (tokenBalanceData) {
            const formattedBalance = formatBalance(tokenBalanceData.value, tokenBalanceData.decimals);
            if (mounted) {
              setTokenBalance(formattedBalance);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching balance:', error);
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
  }, [isConnected, address, fromToken, fromChain, nativeBalance, tokenBalanceData, chainId, isChainMatching, debouncedUpdateBalance]);

  // Add effect to handle network changes
  useEffect(() => {
    if (isConnected && chain) {
      // Reset balance when chain changes
      setTokenBalance("0");
      // Refetch balance after a short delay
      setTimeout(() => {
        if (fromToken?.symbol === (showTestnet ? 'SepoliaETH' : 'ETH')) {
          refetchNativeBalance();
        } else {
          refetchTokenBalance();
        }
      }, 1000);
    }
  }, [chain, isConnected, fromToken, refetchNativeBalance, refetchTokenBalance]);

  // Add amount validation
  const [amountError, setAmountError] = useState<string>("");

  const validateAmount = (value: string): boolean => {
    if (!value) {
      setAmountError("");
      return true;
    }

    const numericAmount = parseFloat(value);
    const numericBalance = fromChain === 'STRATO' 
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
      setAmountError(`Insufficient balance. Maximum amount: ${fromChain === 'STRATO' ? stratoBalance : tokenBalance} ${fromChain === 'STRATO' ? 'STRATO' : fromToken?.symbol}`);
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

  // Update available networks based on testnet status
  const availableNetworks = showTestnet 
    ? ['Sepolia', 'Ethereum']  // Show both Sepolia and Ethereum in testnet mode
    : ['Ethereum', 'Polygon', 'STRATO'];

  // Set initial network and token
  useEffect(() => {
    if (!fromChain) {
      setFromChain(showTestnet ? 'Sepolia' : 'Ethereum');
    }
    if (!fromToken) {
      const defaultToken = showTestnet 
        ? TESTNET_TOKENS.find(t => t.symbol === 'SepoliaETH')
        : BRIDGEABLE_TOKENS.find(t => t.symbol === 'ETH');
      if (defaultToken) {
        setFromToken(defaultToken);
        setToToken(defaultToken); // Set toToken to same as fromToken
      }
    }
  }, [showTestnet, fromChain, fromToken]);

  const handleDisconnect = () => {
    disconnect();
    setIsNetworkChanged(false); // Reset network changed state when manually disconnected
  };

  const handleChainChange = (value: string) => {
    setFromChain(value);
    // Disconnect wallet when network changes
    if (isConnected) {
      disconnect();
      setIsNetworkChanged(true);
    }
    // Reset tokens when chain changes
    setFromToken(null);
    setToToken(null);
  };

  const handleSwap = () => {
    swapChains();
    if (isConnected) {
      disconnect();
      setIsNetworkChanged(true);
    }
  };

  // Add effect to reset isNetworkChanged when wallet connects
  useEffect(() => {
    if (isConnected) {
      setIsNetworkChanged(false);
    }
  }, [isConnected]);

  // Add effect to ensure toToken is always same as fromToken
  useEffect(() => {
    if (fromToken) {
      setToToken(fromToken);
    }
  }, [fromToken]);

  const handleBridgeSubmit = async () => {
    if (!isConnected) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first",
        variant: "destructive",
      });
      return;
    }

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }

    try {
      // For STRATO to other networks transfers, directly call the API
      if (fromChain === 'STRATO' && toChain !== 'STRATO') {
        const tokenAddress = TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol];
        if (!tokenAddress) {
          toast({
            title: "Token Error",
            description: `Invalid token address for ${fromToken.symbol} on ${fromChain}`,
            variant: "destructive",
          });
          return;
        }

        // Show initial toast
        toast({
          title: "Transaction Submitted",
          // description: "Waiting for signer to approve",
        });

        // Call the STRATO to Ethereum transfer endpoint
        const response = await fetch(`${BRIDGE_API_BASE_URL}/api/safe/strato-to-ethereum`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            hash: transactionHash || '',
            value: amount.toString(),
            from: SAFE_ADDRESS,
            to: address,
            token: tokenAddress,
          })
        });

        const result = await response.json();
        
        if (!response.ok) {
          const errorData = result;
          if (response.status === 403) {
            toast({
              title: "Session Expired",
              description: "Your session has expired. Please refresh the page and try again.",
              variant: "destructive",
            });
            return;
          }
          throw new Error(errorData.error || 'Failed to initiate transfer');
        }

        // Check if the response indicates success (either through success flag or status code)
        if (response.ok || result.success) {
          toast({
            title: "Transaction Proposed Successfully",
            description: "Your transaction has been proposed and is waiting for approval"
          });
          setTransactionHash(result.txHash);
          updateTransactionStatus?.(result.txHash, 'pending');
          onClose();
        } else {
          throw new Error(result.message || 'Transfer failed');
        }
        return;
      }

      // For other network transfers, use handleBridgeIn
      await handleBridgeIn();
      onClose();
    } catch (error: any) {
      console.error('Bridge transaction failed:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to bridge assets. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleBridgeIn = async () => {
    try {
      // Check if on correct network
      if (!isChainMatching()) {
        try {
          await handleNetworkSwitch();
        } catch (error) {
          console.error('Failed to switch chain:', error);
          toast({
            title: "Network Error",
            description: "Please switch to the correct network in your wallet",
            variant: "destructive",
          });
          return;
        }
      }

      // Validate token and amount
      if (!fromToken || !amount || !fromChain || !toChain) {
        toast({
          title: "Invalid Input",
          description: "Please check token and amount",
          variant: "destructive",
        });
        return;
      }
      
      const tokenAddress = TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol];
      if (!tokenAddress) {
        toast({
          title: "Token Error",
          description: "Invalid token address",
          variant: "destructive",
        });
        return;
      }

      // Determine recipient address based on network direction
      const recipient = fromChain === 'STRATO' 
        ? TOKEN_ADDRESSES[toChain]?.[toToken.symbol] || ''
        : SAFE_ADDRESS;

      toast({
        title: "Preparing transaction...",
        description: "Please wait while we prepare your transaction",
      });

      try {
        let hash: `0x${string}` | undefined;

        if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
          // Native token logic using wagmi's sendTransactionAsync
          const txHash = await sendTransactionAsync({
            to: recipient as `0x${string}`,
            value: parseEther(amount),
          });

          if (!txHash) {
            throw new Error('Transaction failed to submit');
          }

          hash = txHash as `0x${string}`;
          toast({
            title: "Transaction submitted",
            description: "Waiting for confirmation...",
          });
          setTransactionHash(hash);

          // Wait for transaction confirmation
          const client = createPublicClient({
            chain: showTestnet ? sepolia : mainnet,
            transport: http()
          });
          const receipt = await client.waitForTransactionReceipt({ hash });

          if (receipt.status === 'success') {
            // Refresh balance after successful transfer
            if (fromToken.symbol === (showTestnet ? 'SepoliaETH' : 'ETH')) {
              const balance = await client.getBalance({ address: address as `0x${string}` });
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
                    name: 'balanceOf',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [{ name: 'account', type: 'address' }],
                    outputs: [{ name: '', type: 'uint256' }],
                  },
                ],
                functionName: 'balanceOf',
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
        } else {
          // Token transfer using bridge contract
          const contractConfig = {
            address: BRIDGE_CONTRACT_ADDRESS as `0x${string}`,
            abi: BRIDGE_ABI,
            functionName: 'bridge' as const,
            args: [
              tokenAddress as `0x${string}`,
              parseUnits(amount, 18),
              recipient as `0x${string}`
            ] as const,
            chain: NETWORK_CONFIGS[fromChain],
            account: address,
          };

          hash = await writeContractAsync(contractConfig);

          if (!hash) {
            throw new Error('Transaction failed to submit');
          }
          toast({
            title: "Transaction submitted",
            description: "Waiting for confirmation...",
          });
          setTransactionHash(hash);

          // Wait for transaction confirmation
          const client = createPublicClient({
            chain: showTestnet ? sepolia : mainnet,
            transport: http()
          });
          const receipt = await client.waitForTransactionReceipt({ hash });

          if (receipt.status === 'success') {
            // Refresh balance after successful transfer
            const balance = await client.readContract({
              address: tokenAddress as `0x${string}`,
              abi: [
                {
                  name: 'balanceOf',
                  type: 'function',
                  stateMutability: 'view',
                  inputs: [{ name: 'account', type: 'address' }],
                  outputs: [{ name: '', type: 'uint256' }],
                },
              ],
              functionName: 'balanceOf',
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

        toast({
          title: "Success",
          description: "Transaction completed successfully",
        });

      } catch (error: any) {
        console.error('Transaction error:', error);
        
        if (error.message?.toLowerCase().includes('user rejected')) {
          toast({
            title: "Transaction Rejected",
            description: "Transaction was rejected by user",
            variant: "destructive",
          });
          updateTransactionStatus?.(transactionHash || '', 'failed');
        } else {
          console.log('Transaction failed:', error.message);
          toast({
            title: "Transaction Failed",
            description: error.message || "Transaction failed. Please try again.",
            variant: "destructive",
          });
          updateTransactionStatus?.(transactionHash || '', 'failed');
        }
      }
    } catch (error: any) {
      console.error('Bridge error:', error);
      toast({
        title: "Transfer Failed",
        description: error instanceof Error ? error.message : "Failed to process transfer",
        variant: "destructive",
      });
    }
  };

  const handleBack = () => {
    navigate(-1);
  };
  
  useEffect(() => {
    const fetchBalance = async () => {
      if (fromChain === 'STRATO') {
        try {
          setIsStratoLoading(true);
          setStratoBalance("0"); // Reset balance while loading
          const balance = await fetchUserBalance("0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce");
          if (balance.success) {
            // Convert balance from wei to ether (divide by 10^18)
            const balanceInEther = (Number(balance.data.balance) / Math.pow(10, 18)).toString();
            setStratoBalance(balanceInEther);
          }
        } catch (error) {
          console.error('Error fetching Strato balance:', error);
          setStratoBalance("0");
        } finally {
          setIsStratoLoading(false);
        }
      }
    };

    fetchBalance();
  }, [fromChain]); 

  return (
    <>
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
      <Dialog open={isOpen} onOpenChange={onClose}>
        <div className="min-h-screen bg-white">
          <div className="max-w-3xl mx-auto p-6">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-lg p-8">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-6 w-6 text-blue-600" />
                  <h1 className="text-2xl font-semibold text-gray-900">Bridge Assets</h1>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => navigate('/dashboard/bridge-transactions')}
                >
                  <History className="h-4 w-4" />
                  View Transactions
                </Button>
              </div>

              <div className="grid gap-6">
                <div className="flex items-center">
                  {isConnected ? (
                    <div 
                      onClick={handleDisconnect}
                      className="relative group cursor-pointer"
                    >
                      <div className="px-4 py-2 bg-green-50 text-green-600 rounded-xl font-semibold group-hover:opacity-0 transition-opacity">
                        Wallet Connected
                      </div>
                      <div className="absolute inset-0 bg-red-50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-red-600 font-semibold">Disconnect</span>
                      </div>
                    </div>
                  ) : (
                    <div className="[&>button]:bg-gradient-to-r [&>button]:from-[#1f1f5f] [&>button]:via-[#293b7d] [&>button]:to-[#16737d] [&>button]:text-white [&>button]:px-4 [&>button]:py-2 [&>button]:rounded-xl [&>button]:font-semibold [&>button]:hover:opacity-90 [&>button]:transition-all">
                      <ConnectButton label={isNetworkChanged ? "Switch Network" : "Connect Wallet"} />
                    </div>
                  )}
                </div>
                
                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="space-y-6">
                    <div className="space-y-1.5">
                      <Label htmlFor="asset">Select Asset</Label>
                      <Select
                        value={fromToken?.symbol || ''}
                        onValueChange={(value) => {
                          const token = availableTokens.find(t => t.symbol === value);
                          if (token) {
                            setFromToken(token);
                            setToToken(token);
                          }
                        }}
                      >
                        <SelectTrigger id="from-token">
                          <SelectValue>
                            {fromToken ? `${fromToken.name} (${fromToken.symbol})` : 'Select asset'}
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
                        className={`w-full ${amountError ? 'border-red-500 focus:ring-red-400' : ''}`}
                        value={amount}
                        onChange={handleAmountChange}
                        disabled={fromChain === 'STRATO' && (isStratoLoading || !stratoBalance)}
                      />
                      {amountError && (
                        <p className="text-sm text-red-500">{amountError}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {(isBalanceLoading || isStratoLoading || isTokenLoading) ? (
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                            <p className="text-sm text-gray-500">Fetching balance...</p>
                          </div>
                        ) : (
                          fromChain === 'STRATO' ? (
                            stratoBalance && (
                              <p className="text-sm text-gray-500">
                                Balance: {stratoBalance} STRATO
                              </p>
                            )
                          ) : (
                            tokenBalance && (
                              <p className="text-sm text-gray-500">
                                Balance: {tokenBalance} {fromToken?.symbol}
                              </p>
                            )
                          )
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="from">From Network</Label>
                        <Select 
                          value={fromChain} 
                          onValueChange={handleChainChange}
                        >
                          <SelectTrigger id="from-chain">
                            <SelectValue placeholder="Select network">
                              {fromChain || 'Select network'}
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
                        onClick={handleSwap}
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
                              {toChain || 'Select network'}
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

                <div className="bg-white rounded-xl p-6 shadow-sm">
                  <div className="space-y-4">
                    <h3 className="font-medium text-gray-900">Transaction Details</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Bridge Fee:</span>
                        <span>0.1%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Estimated Time:</span>
                        <span>2-5 minutes</span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 space-y-1">
                      <p>• Bridge assets between Ethereum and STRATO networks</p>
                      <p>• Small bridge fee applies</p>
                      <p>• Transaction time varies by network congestion</p>
                      <p>• STRATO to Ethereum transfers require approval</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-4">
                  <Button 
                    variant="outline" 
                    onClick={handleBack}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleBridgeSubmit} 
                    disabled={Boolean(
                      isLoading || 
                      !amount || 
                      !fromToken || 
                      !isConnected || 
                      (fromChain !== 'STRATO' && !isChainMatching()) || 
                      (fromChain === 'STRATO' && toChain !== 'STRATO' ? false : amountError !== "")
                    )}
                    className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
                  >
                    {isLoading ? 'Processing...' : 'Bridge Assets'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

      </Dialog>
    </>
  );
};

export default BridgeModal; 