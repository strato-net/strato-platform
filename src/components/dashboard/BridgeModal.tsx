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
  SAFE_ADDRESS 
} from '@/lib/bridge/constants';
import { useAccount, useDisconnect, useChainId, useSwitchChain, useBalance, useToken, useConnect } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Add utility function for formatting balance
const formatBalance = (value: bigint, decimals: number): string => {
  const formattedBalance = Number(value) / Math.pow(10, decimals);
  return formattedBalance.toFixed(decimals);
};

const BridgeModal = ({ isOpen, onClose }: BridgeModalProps) => {
  const [showTransactions, setShowTransactions] = useState(false);
  const [isNetworkChanged, setIsNetworkChanged] = useState(false);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
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
    handleBridge,
    swapChains,
  } = useBridge();

  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { connect } = useConnect();

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
        // Set the corresponding ST token
        const stToken = showTestnet
          ? TESTNET_TOKENS.find(t => t.symbol === defaultToken.stSymbol)
          : BRIDGEABLE_TOKENS.find(t => t.symbol === defaultToken.stSymbol);
        if (stToken) setToToken(stToken);
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

    // Log transaction details
    console.log('Bridge Transaction Details:', {
      from: {
        network: fromChain,
        address: address,
        token: fromToken?.symbol,
        amount: amount,
        balance: tokenBalance
      },
      to: {
        network: toChain,
        address: SAFE_ADDRESS,
        token: toToken?.symbol
      },
      user: {
        walletAddress: address,
        currentChainId: chainId
      },
      transaction: {
        timestamp: new Date().toISOString(),
        status: 'pending'
      }
    });

    try {
      await handleBridge();
      toast({
        title: "Success",
        description: "Your bridge request has been submitted. Please check the transaction status.",
      });
      onClose();
      setShowTransactions(true);
    } catch (error) {
      console.error('Bridge transaction failed:', error);
      toast({
        title: "Error",
        description: "Failed to bridge assets. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleConnect = async () => {
    try {
      if (!isConnected) {
        await connect({ connector: undefined });
      }
    } catch (error) {
      console.error('Connection error:', error);
      toast({
        title: "Connection Error",
        description: "Failed to connect wallet. Please try again.",
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
                      if (!toToken) {
                        const stToken = availableTokens.find(t => t.symbol === token.stSymbol);
                        if (stToken) setToToken(stToken);
                      }
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