import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeftRight, ArrowDownUp, History, Wallet, LogOut } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import BridgeTransactionsModal from './BridgeTransactionsModal';
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
import { useAccount, useDisconnect, useChainId, useSwitchChain, useBalance, useToken, useConnect, useSendTransaction, useWriteContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { parseEther, parseUnits, createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateTransactionStatus?: (hash: string, status: string) => void;
}

interface Token {
  symbol: string;
  stSymbol: string;
  name: string;
  stName: string;
  decimals?: number;
}

// Add utility function for formatting balance
const formatBalance = (value: bigint, decimals: number): string => {
  const formattedBalance = Number(value) / Math.pow(10, decimals);
  return formattedBalance.toFixed(decimals);
};

const BridgeModal = ({ isOpen, onClose, updateTransactionStatus }: BridgeModalProps) => {
  const [showTransactions, setShowTransactions] = useState(false);
  const [isNetworkChanged, setIsNetworkChanged] = useState(false);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | undefined>();
  const { toast } = useToast();
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
    handleBridge: bridgeContextHandleBridge,
    swapChains,
  } = useBridge();

  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { connect } = useConnect();
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
      const targetChainId = NETWORK_CONFIGS[fromChain]?.chainId;
      if (!targetChainId) {
        throw new Error('Invalid network selected');
      }

      await switchChain({ chainId: targetChainId });
      // Reset balance after network switch
      setTokenBalance("0");
      setIsNetworkChanged(false);
    } catch (error) {
      console.error('Network switch error:', error);
      toast({
        title: "Network Switch Failed",
        description: `Please switch to ${fromChain} network in your wallet`,
        variant: "destructive",
      });
    }
  };

  // Update balance fetching hooks
  const { data: nativeBalance } = useBalance({
    address,
    chainId: NETWORK_CONFIGS[fromChain]?.chainId,
    ...(isConnected && !!address && !!fromChain && fromToken?.symbol === (showTestnet ? 'SepoliaETH' : 'ETH') && isChainMatching() ? {} : { enabled: false })
  });

  const { data: tokenBalanceData } = useBalance({
    address,
    token: fromToken ? (TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol] as `0x${string}`) : undefined,
    chainId: NETWORK_CONFIGS[fromChain]?.chainId,
    ...(isConnected && !!address && !!fromChain && !!fromToken && fromToken.symbol !== (showTestnet ? 'SepoliaETH' : 'ETH') && isChainMatching() ? {} : { enabled: false })
  });

  // Update balance effect
  useEffect(() => {
    if (!isConnected || !address || !fromToken || !fromChain) {
      setTokenBalance("0");
      return;
    }

    // Only fetch balance if we're on the correct network
    if (!isChainMatching()) {
      setTokenBalance("0");
      return;
    }

    // Reset balance when token changes
    setTokenBalance("0");

    // Fetch balance based on token type
    if (fromToken.symbol === (showTestnet ? 'SepoliaETH' : 'ETH')) {
      if (nativeBalance) {
        const formattedBalance = formatBalance(nativeBalance.value, nativeBalance.decimals);
        setTokenBalance(formattedBalance);
      }
    } else {
      if (tokenBalanceData) {
        const formattedBalance = formatBalance(tokenBalanceData.value, tokenBalanceData.decimals);
        setTokenBalance(formattedBalance);
      }
    }
  }, [isConnected, address, fromToken, fromChain, nativeBalance, tokenBalanceData, chainId, isChainMatching]);

  // Add amount validation
  const [amountError, setAmountError] = useState<string>("");

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
      setAmountError(`Insufficient balance. Maximum amount: ${tokenBalance}`);
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

  const handleBridge = async () => {
    if (!isConnected) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first",
        variant: "destructive",
      });
      return;
    }

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

      // Debug log to check token values
      console.log('Token Validation:', {
        fromToken,
        toToken,
        fromChain,
        toChain,
        amount,
        tokenBalance
      });

      // More specific token validation
      if (!fromToken || !fromToken.symbol || !fromToken.name) {
        console.error('From token validation failed:', fromToken);
        toast({
          title: "Token Error",
          description: "Please select a valid source token",
          variant: "destructive",
        });
        return;
      }

      if (!toToken || !toToken.symbol || !toToken.name) {
        console.error('To token validation failed:', toToken);
        toast({
          title: "Token Error",
          description: "Please select a valid destination token",
          variant: "destructive",
        });
        return;
      }

      const tokenAddress = TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol];
      if (!tokenAddress) {
        console.error('Token address not found:', {
          fromChain,
          symbol: fromToken.symbol,
          availableTokens: TOKEN_ADDRESSES[fromChain]
        });
        toast({
          title: "Token Error",
          description: "Invalid token address",
          variant: "destructive",
        });
        return;
      }

      // Determine recipient address based on network direction
      let recipient: string;
      if (fromChain === 'STRATO') {
        // If sending from STRATO, use the target network's address
        recipient = TOKEN_ADDRESSES[toChain]?.[toToken.symbol] || '';
      } else {
        // If sending to STRATO, use SAFE_ADDRESS
        recipient = SAFE_ADDRESS;
      }

      if (!recipient) {
        console.error('Recipient address not found:', {
          fromChain,
          toChain,
          toTokenSymbol: toToken.symbol
        });
        toast({
          title: "Recipient Error",
          description: "Invalid recipient address",
          variant: "destructive",
        });
        return;
      }

      // Prepare transaction data
      const transactionData = {
        fromChain,
        toChain,
        token: fromToken,
        amount,
        recipient
      };

      // Log detailed transaction information
      console.log('Bridge Transaction Details:', {
        transaction: {
          type: 'BRIDGE_TRANSACTION',
          timestamp: new Date().toISOString(),
          status: 'PENDING',
          hash: transactionHash || 'Not yet generated'
        },
        from: {
          network: fromChain,
          token: {
            symbol: fromToken.symbol,
            name: fromToken.name,
            address: tokenAddress,
            amount: amount,
            decimals: 18 // Using standard 18 decimals for ERC20
          },
          userAddress: address,
          balance: tokenBalance
        },
        to: {
          network: toChain,
          token: {
            symbol: toToken.symbol,
            name: toToken.name,
            address: TOKEN_ADDRESSES[toChain]?.[toToken.symbol] || 'N/A'
          },
          recipientAddress: recipient
        },
        network: {
          fromChainId: chainId,
          toChainId: NETWORK_CONFIGS[toChain]?.chainId,
          isNativeToken: tokenAddress === NATIVE_TOKEN_ADDRESS
        },
        user: {
          walletAddress: address,
          isConnected: isConnected,
          currentNetwork: chain?.name
        }
      });

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
            value: parseEther(amount)
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
            console.log('Transaction Success:', {
              hash,
              timestamp: new Date().toISOString(),
              status: 'SUCCESS',
              from: {
                network: fromChain,
                token: fromToken.symbol,
                amount: amount
              },
              to: {
                network: toChain,
                token: toToken.symbol
              }
            });

            // Refresh balance after successful transfer
            if (fromToken.symbol === (showTestnet ? 'SepoliaETH' : 'ETH')) {
              console.log('Fetching native token balance...');
              const balance = await client.getBalance({ address: address as `0x${string}` });
              const formattedBalance = formatBalance(balance, 18);
              console.log('New native token balance:', {
                address: address,
                balance: formattedBalance,
                symbol: fromToken.symbol
              });
              
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
              console.log('Fetching ERC20 token balance...');
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
              console.log('New ERC20 token balance:', {
                address: address,
                tokenAddress: tokenAddress,
                balance: formattedBalance,
                symbol: fromToken.symbol
              });
              
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
            account: address
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
            console.log('Transaction Success:', {
              hash,
              timestamp: new Date().toISOString(),
              status: 'SUCCESS',
              from: {
                network: fromChain,
                token: fromToken.symbol,
                amount: amount
              },
              to: {
                network: toChain,
                token: toToken.symbol
              }
            });

            console.log('Fetching ERC20 token balance...');
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
            console.log('New ERC20 token balance:', {
              address: address,
              tokenAddress: tokenAddress,
              balance: formattedBalance,
              symbol: fromToken.symbol
            });
            
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

        // Log successful transaction
        console.log('Transaction Submitted:', {
          hash,
          timestamp: new Date().toISOString(),
          status: 'SUBMITTED',
          details: transactionData
        });

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
      console.error('Bridge transaction failed:', error);
      toast({
        title: "Transaction Failed",
        description: error.message || "Transaction failed. Please try again.",
        variant: "destructive",
      });
      updateTransactionStatus?.(transactionHash || '', 'failed');
    }
  };

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
      await handleBridge();
      onClose();
      setShowTransactions(true);
    } catch (error: any) {
      console.error('Bridge transaction failed:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to bridge assets. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="h-5 w-5" />
                Bridge Assets
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2"
                onClick={() => setShowTransactions(true)}
              >
                <History className="h-4 w-4" />
                View Transactions
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="flex items-center">
              {isConnected ? (
                <div 
                  onClick={handleDisconnect}
                  className="relative group cursor-pointer"
                >
                  <div className="px-4 py-3 bg-green-50 text-green-600 rounded-xl font-semibold group-hover:opacity-0 transition-opacity">
                    Wallet Connected
                  </div>
                  <div className="absolute inset-0 bg-red-50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-red-600 font-semibold">Disconnect</span>
                  </div>
                </div>
              ) : (
                <div className=" [&>button]:bg-gradient-to-r [&>button]:from-[#1f1f5f] [&>button]:via-[#293b7d] [&>button]:to-[#16737d] [&>button]:text-white [&>button]:px-4 [&>button]:py-3 [&>button]:rounded-xl [&>button]:font-semibold [&>button]:hover:opacity-90 [&>button]:transition-all">
                  <ConnectButton label={isNetworkChanged ? "Switch Network" : "Connect Wallet"} />
                </div>
              )}
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="asset">Select Asset</Label>
                <Select
                  value={fromToken?.symbol || ''}
                  onValueChange={(value) => {
                    const token = availableTokens.find(t => t.symbol === value);
                    if (token) {
                      setFromToken(token);
                      setToToken(token); // Explicitly set toToken
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

              <div className="space-y-2">
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
                />
                {amountError && (
                  <p className="text-sm text-red-500">{amountError}</p>
                )}
                {tokenBalance && (
                  <p className="text-sm text-gray-500">
                    Balance: {tokenBalance} {fromToken?.symbol}
                  </p>
                )}
              </div>

              <div className="space-y-2">
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

              <div className="space-y-2">
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

              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSwap}
                  className="rounded-full hover:bg-gray-100"
                >
                  <ArrowDownUp className="h-4 w-4" />
                </Button>
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
              <p>• Bridge assets between Ethereum and STRATO networks</p>
              <p>• Small bridge fee applies</p>
              <p>• Transaction time varies by network congestion</p>
              <p>• STRATO to Ethereum transfers require approval</p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={onClose} className="mr-2">
              Cancel
            </Button>
            <Button 
              onClick={handleBridgeSubmit} 
              disabled={isLoading || !amount || !fromToken || !isConnected || !isChainMatching()}
              className="bg-strato-blue hover:bg-strato-blue/90"
            >
              {isLoading ? 'Processing...' : 'Bridge Assets'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BridgeTransactionsModal
        isOpen={showTransactions}
        onClose={() => setShowTransactions(false)}
      />
    </>
  );
};

export default BridgeModal; 