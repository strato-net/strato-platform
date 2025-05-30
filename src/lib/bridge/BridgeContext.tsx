import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAccount, useBalance, useWriteContract } from 'wagmi';
import { BRIDGEABLE_TOKENS, TOKEN_ADDRESSES } from './constants';
import { mainnet, polygon, sepolia } from 'wagmi/chains';

interface BridgeContextType {
  fromChain: string;
  toChain: string;
  fromToken: typeof BRIDGEABLE_TOKENS[0] | null;
  toToken: typeof BRIDGEABLE_TOKENS[0] | null;
  amount: string;
  tokenBalance: string;
  isLoading: boolean;
  showTestnet: boolean;
  setFromChain: (chain: string) => void;
  setToChain: (chain: string) => void;
  setFromToken: (token: typeof BRIDGEABLE_TOKENS[0] | null) => void;
  setToToken: (token: typeof BRIDGEABLE_TOKENS[0] | null) => void;
  setAmount: (amount: string) => void;
  setTokenBalance: (balance: string) => void;
  swapChains: () => void;
}

const SHOW_TESTNET = import.meta.env.VITE_SHOW_TESTNET;

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showTestnet] = useState(
    SHOW_TESTNET === 'true'
  );
  const [fromChain, setFromChain] = useState(showTestnet ? 'Sepolia' : 'Ethereum');
  const [toChain, setToChain] = useState('STRATO');
  const [fromToken, setFromToken] = useState<typeof BRIDGEABLE_TOKENS[0] | null>(
    showTestnet 
      ? BRIDGEABLE_TOKENS.find(t => t.symbol === 'SepoliaETH') || null
      : BRIDGEABLE_TOKENS.find(t => t.symbol === 'ETH') || null
  );
  const [toToken, setToToken] = useState<typeof BRIDGEABLE_TOKENS[0] | null>(null);
  const [amount, setAmount] = useState('');
  const [tokenBalance, setTokenBalance] = useState('0');
  const [isLoading, setIsLoading] = useState(false);

  const { address } = useAccount();
  const { writeContract } = useWriteContract();


  const { data: balance } = useBalance({
    address,
    token: fromToken ? (TOKEN_ADDRESSES[fromChain]?.[fromToken.symbol] as `0x${string}`) : undefined,
    chainId: fromChain === 'Ethereum' ? (showTestnet ? sepolia.id : mainnet.id) : polygon.id,
  });

  useEffect(() => {
    if (balance) {
      setTokenBalance(balance.formatted);
    } else {
      setTokenBalance('0');
    }
  }, [balance]);

  const swapChains = () => {
    // Store current values
    const currentFromChain = fromChain;
    const currentToChain = toChain;
    const currentFromToken = fromToken;
    const currentToToken = toToken;

    // Update chains
    if (currentFromChain === "STRATO") {
      setFromChain(currentToChain);
      setToChain("STRATO");
    } else {
      setToChain(currentFromChain);
      setFromChain("STRATO");
    }

    // Update tokens
    if (currentFromToken && currentToToken) {
      // Find the corresponding tokens in BRIDGEABLE_TOKENS
      const newFromToken = BRIDGEABLE_TOKENS.find(t => t.symbol === currentToToken.symbol);
      const newToToken = BRIDGEABLE_TOKENS.find(t => t.symbol === currentFromToken.symbol);
      
      if (newFromToken && newToToken) {
        setFromToken(newFromToken);
        setToToken(newToToken);
      }
    } else {
      // If tokens are null, set them to null to maintain state
      setFromToken(null);
      setToToken(null);
    }
  };

 

  const value = {
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
  };

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
};

export const useBridge = () => {
  const context = useContext(BridgeContext);
  if (context === undefined) {
    throw new Error('useBridge must be used within a BridgeProvider');
  }
  return context;
}; 