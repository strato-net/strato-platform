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
  useWriteContract,
  useSwitchChain,
} from "wagmi";
import { createPublicClient, http } from "viem";
import { parseUnits } from "ethers";
import { NATIVE_TOKEN_ADDRESS, resolveViemChain, DEPOSIT_ROUTER_ABI } from "@/lib/bridge/constants";
import { bridgeContractService } from "@/lib/bridge/contractService";
import { safeParseUnits, formatBalance } from "@/utils/numberUtils";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from '@/context/UserContext';
import BridgeWalletStatus from './BridgeWalletStatus';
import PercentageButtons from "@/components/ui/PercentageButtons";

// Types
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

// Constants
const DECIMAL_PATTERN = /^\d*\.?\d*$/;
const BRIDGE_FEE = "0.1%";
const ESTIMATED_TIME = "2-5 minutes";

const BridgeIn: React.FC<{ networkChainId: string | null }> = ({ networkChainId }) => {
  // Hooks
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
  } = useBridgeContext();

  // State
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({ amount: "", balance: "", network: "" });

  // Computed
  const selectedNetworkConfig = availableNetworks.find(n => n.chainName === selectedNetwork);
  const expectedChainId = selectedNetworkConfig ? parseInt(selectedNetworkConfig.chainId) : null;
  const isCorrectNetwork = isConnected && chainId && expectedChainId && chainId === expectedChainId;
  const isNativeToken = selectedToken?.extToken === NATIVE_TOKEN_ADDRESS;

  // Balance hooks
  const { data: nativeBalance, refetch: refetchNative, isError: nativeError, isLoading: nativeLoading } = useBalance({
    address,
    chainId: expectedChainId || undefined,
    query: { enabled: isConnected && !!address && !!expectedChainId && isNativeToken }
  });

  const { data: tokenBalanceData, refetch: refetchToken, isError: tokenError, isLoading: tokenLoading } = useBalance({
    address,
    token: selectedToken?.extToken as `0x${string}`,
    chainId: expectedChainId || undefined,
    query: { enabled: isConnected && !!address && !!expectedChainId && !!selectedToken && !isNativeToken }
  });

  // Computed balance loading state
  const isBalanceLoading = isConnected && !!address && !!expectedChainId && (nativeLoading || tokenLoading);

  // Effects
  useEffect(() => {
    if (!selectedToken && bridgeableTokens.length > 0) {
      setSelectedToken(bridgeableTokens[0]);
    }
  }, [bridgeableTokens, selectedToken]);

  // Reset amount when token changes
  useEffect(() => {
    setAmount("");
    setErrors(e => ({ ...e, amount: "" }));
  }, [selectedToken]);

  useEffect(() => {
    const handleNetworkSwitch = async () => {
      if (isConnected && selectedNetwork && expectedChainId && chainId !== expectedChainId) {
        setErrors(e => ({ ...e, network: `Switching to ${selectedNetwork} network...` }));
        try {
          await switchChain({ chainId: expectedChainId });
        } catch {
          setErrors(e => ({ ...e, network: `Please manually switch to ${selectedNetwork} network` }));
        }
      } else {
        setErrors(e => ({ ...e, network: isConnected && !selectedNetwork ? "Please select a network" : "" }));
      }
    };
    handleNetworkSwitch();
  }, [chainId, isConnected, selectedNetwork, expectedChainId, switchChain]);

  useEffect(() => {
    const balance = isNativeToken ? nativeBalance : tokenBalanceData;
    const error = isNativeToken ? nativeError : tokenError;
    
    if (balance) {
      setTokenBalance(formatBalance(balance.value, undefined, balance.decimals));
      setErrors(e => ({ ...e, balance: "" }));
    } else if (error && selectedToken) {
      setErrors(e => ({ ...e, balance: `Failed to fetch ${selectedToken.extSymbol} balance` }));
    }
  }, [isNativeToken, nativeBalance, tokenBalanceData, nativeError, tokenError, selectedToken]);

  // Handlers
  const validateAmount = (value: string): boolean => {
    if (!value) {
      setErrors(e => ({ ...e, amount: "" }));
      return true;
    }

    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
      setErrors(e => ({ ...e, amount: num <= 0 ? "Amount must be greater than 0" : "Please enter a valid number" }));
      return false;
    }

    const balanceMatch = tokenBalance.match(/^([\d,]+\.?\d*)/);
    const bal = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : 0;

    if (num > bal) {
      setErrors(e => ({ ...e, amount: `Insufficient balance. Maximum: ${tokenBalance} ${selectedToken?.extSymbol}` }));
      return false;
    }

    setErrors(e => ({ ...e, amount: "" }));
    return true;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (DECIMAL_PATTERN.test(value)) {
      setAmount(value);
      validateAmount(value);
    }
  };

  const handleBridge = async () => {
    if (!selectedToken || !amount || !isConnected || !isCorrectNetwork || !address || !userAddress) {
      toast({
        title: "Error",
        description: !userAddress ? "User address not available" : "Invalid configuration",
        variant: "destructive",
      });
      return;
    }

    if (!selectedNetworkConfig) {
      toast({
        title: "Error",
        description: "Selected network configuration not found",
        variant: "destructive",
      });
      return;
    }

    if (selectedToken.extToken !== NATIVE_TOKEN_ADDRESS) {
      toast({
        title: "Unsupported Token",
        description: "Only ETH deposits are currently supported.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    toast({ title: "Preparing transaction...", description: "Please wait" });

    try {
      const depositRouter = selectedNetworkConfig.depositRouter;
      const chain = await resolveViemChain(networkChainId || "1");
      const client = createPublicClient({ chain, transport: http() });

      // Validate
      const validation = await bridgeContractService.validateRouterContract({
        depositRouterAddress: depositRouter,
        amount,
        decimals: selectedToken.extDecimals,
        chainId: networkChainId || "1"
      });

      if (!validation.isValid) throw new Error(validation.error);

      // Simulate
      await client.simulateContract({
        address: depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "depositETH",
        args: [bridgeContractService.formatAddress(userAddress)],
        value: parseUnits(amount, parseInt(selectedToken.extDecimals)),
        account: address as `0x${string}`,
      });

      // Execute
      const txHash = await writeContractAsync({
        address: depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "depositETH",
        args: [bridgeContractService.formatAddress(userAddress)],
        value: parseUnits(amount, parseInt(selectedToken.extDecimals)),
        chain,
        account: address as `0x${string}`,
      });

      toast({
        title: "Bridge Initiated",
        description: "Your deposit has been submitted successfully. The relayer will process it shortly.",
      });

      const newBalance = await bridgeContractService.getTokenBalance({
        tokenAddress: selectedToken.extToken,
        userAddress: address,
        chainId: networkChainId || "1",
      });
      setTokenBalance(newBalance);
    } catch (error: any) {
      toast({
        title: "Transaction Failed",
        description: error?.message || "Failed to complete bridge",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };



  return (
    <div className="space-y-6">
      <BridgeWalletStatus />
      
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label>From Network</Label>
          <Select value={selectedNetwork || ""} onValueChange={v => { setSelectedNetwork(v); setSelectedToken(null); }}>
            <SelectTrigger><SelectValue placeholder="Select network" /></SelectTrigger>
            <SelectContent>
              {availableNetworks.map(n => (
                <SelectItem key={n.chainId} value={n.chainName}>{n.chainName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>To Network</Label>
          <Input value="STRATO" disabled className="bg-gray-50" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Select Asset</Label>
        <Select
          value={selectedToken?.extSymbol || ""}
          onValueChange={v => setSelectedToken(bridgeableTokens.find(t => t.extSymbol === v) || null)}
          disabled={bridgeableTokens.length === 0}
        >
          <SelectTrigger>
            <SelectValue>
              {selectedToken ? `${selectedToken.extName} (${selectedToken.extSymbol})` : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {bridgeableTokens.map(t => (
              <SelectItem key={t.extSymbol} value={t.extSymbol}>
                {t.extName} ({t.extSymbol})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Amount</Label>
        <Input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          placeholder={isConnected ? (isBalanceLoading ? "Loading..." : "0.00") : "Connect wallet"}
          className={errors.amount ? "border-red-500" : ""}
          value={amount}
          onChange={handleAmountChange}
          disabled={!isConnected || isBalanceLoading}
        />
        {errors.amount && <p className="text-sm text-red-500">{errors.amount}</p>}
        {isConnected && !isBalanceLoading && tokenBalance !== "0" && (
          <PercentageButtons
            value={amount}
            maxValue={safeParseUnits(tokenBalance, 18).toString()}
            onChange={v => { setAmount(v); validateAmount(v); }}
            className="mt-2"
          />
        )}
        
        {isConnected && (
          isBalanceLoading ? (
            <div className="flex items-center gap-2 mt-1">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm text-gray-500">Fetching balance...</span>
            </div>
          ) : errors.balance ? (
            <div className="space-y-2 mt-1">
              <p className="text-sm text-red-500">{errors.balance}</p>
              <button
                onClick={() => isNativeToken ? refetchNative() : refetchToken()}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Retry
              </button>
            </div>
          ) : tokenBalance ? (
            <div className="space-y-2 mt-1">
              <p className="text-sm text-gray-500">Balance: {tokenBalance} {selectedToken?.extSymbol}</p>
              {selectedToken?.stratoTokenSymbol && (
                <p className="text-sm bg-blue-50 p-2 rounded-md border border-blue-100">
                  You will receive {amount || "0"} {selectedToken.stratoTokenName} ({selectedToken.stratoTokenSymbol}) on STRATO
                </p>
              )}
            </div>
          ) : null
        )}
      </div>
      
      <div className="bg-gray-50 p-4 rounded-md space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Bridge Fee:</span>
          <span>{BRIDGE_FEE}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Estimated Time:</span>
          <span>{ESTIMATED_TIME}</span>
        </div>
      </div>

      <div className="text-sm text-gray-500 space-y-1">
        {["Bridge assets between Ethereum and STRATO networks",
          "Small bridge fee applies",
          "Transaction time varies by network congestion",
          "Wallet will automatically switch to the selected network"
        ].map((text, i) => <p key={i}>• {text}</p>)}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleBridge}
          disabled={isLoading || !amount || !selectedToken || !isConnected || !isCorrectNetwork}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading ? "Processing..." : "Bridge Assets"}
        </Button>
      </div>
      
      {errors.network && <p className="text-sm text-red-500">{errors.network}</p>}
    </div>
  );
};

export default BridgeIn;