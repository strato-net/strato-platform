import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useAccount,
  useChainId,
  useBalance,
  useReadContract,
  useWriteContract,
  useSwitchChain,
  useSignTypedData,
} from "wagmi";
import {
  NATIVE_TOKEN_ADDRESS,
  resolveViemChain,
  DEPOSIT_ROUTER_ABI,
  ERC20_ABI,
  PERMIT2_ADDRESS,
  BRIDGE_IN_MODE_LABELS,
} from "@/lib/bridge/constants";
import {
  getTokenConfig,
  checkPermit2Approval,
  waitForTransaction,
  getPermit2Nonce,
  createPermit2Message,
  getPermit2Domain,
  getPermit2Types,
  simulateDeposit,
  validateRouterContract,
} from "@/lib/bridge/contractService";
import {
  normalizeError,
  formatTxHash,
  getExplorerUrl,
} from "@/lib/bridge/utils";
import { ensureHexPrefix, formatBalance, safeParseUnits, formatUnits } from "@/utils/numberUtils";
import { handleAmountInputChange } from "@/utils/transferValidation";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useLendingContext } from "@/context/LendingContext";
import BridgeWalletStatus from "./BridgeWalletStatus";
import NetworkSelector from "./NetworkSelector";
import TokenSelector from "./TokenSelector";
import PercentageButtons from "@/components/ui/PercentageButtons";
import DepositTransactionSummary from "./DepositTransactionSummary";

interface BridgeInProps {
  isConvert?: boolean;
}

const BridgeIn: React.FC<BridgeInProps> = ({ isConvert = false }) => {
  // Hooks & Context
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { fetchUsdstBalance } = useUserTokens();
  const { liquidityInfo } = useLendingContext();
  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
    requestAutoSave,
  } = useBridgeContext();

  // State
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [amountError, setAmountError] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [minDepositInfo, setMinDepositInfo] = useState<{ 
    amount: string; 
    amountWei: bigint; 
    loading: boolean;
  }>({ 
    amount: "", 
    amountWei: 0n,
    loading: false
  });
  const [isTokenPermitted, setIsTokenPermitted] = useState(true);
  const [autoDeposit, setAutoDeposit] = useState(true);

  // Computed values
  const modeLabels = BRIDGE_IN_MODE_LABELS[isConvert ? "convert" : "bridge"];

  const currentTokens = useMemo(() => {
    return bridgeableTokens.filter((token) =>
      isConvert ? !token.bridgeable : token.bridgeable
    );
  }, [bridgeableTokens, isConvert]);

  const currentNetwork = useMemo(() => {
    return availableNetworks.find((n) => n.chainName === selectedNetwork) || null;
  }, [availableNetworks, selectedNetwork]);

  const expectedChainId = currentNetwork?.chainId ? parseInt(currentNetwork.chainId) : null;
  const isCorrectNetwork = isConnected && chainId && expectedChainId && chainId === expectedChainId;
  const isNativeToken = BigInt(selectedToken?.externalToken || "0") === 0n;

  const {
    data: nativeBalance,
    refetch: refetchNative,
    isLoading: nativeLoading,
  } = useBalance({
    address,
    chainId: expectedChainId || undefined,
    query: {
      enabled: isConnected && !!address && !!expectedChainId && isNativeToken,
      refetchInterval: 15000,
    },
  });

  const {
    data: tokenRawBalance,
    refetch: refetchToken,
    isLoading: tokenLoading,
  } = useReadContract({
    address: ensureHexPrefix(selectedToken?.externalToken) as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: expectedChainId || undefined,
    query: {
      enabled:
        isConnected &&
        !!address &&
        !!expectedChainId &&
        !!selectedToken &&
        !isNativeToken,
      refetchInterval: 15000,
    },
  });

  const isBalanceLoading = isConnected && !!address && !!expectedChainId && (nativeLoading || tokenLoading);

  const maxAmount = useMemo(() => {
    if (isNativeToken) {
      if (!nativeBalance?.value) return "0";
      return nativeBalance.value.toString();
    } else {
      if (!tokenRawBalance) return "0";
      return tokenRawBalance.toString();
    }
  }, [isNativeToken, nativeBalance?.value, tokenRawBalance]);

  const hasValidAmount = !!amount && !amountError;

  const balanceImpact = useMemo(() => {
    try {
      const maxAmountWei = BigInt(maxAmount || "0");
      const decimals = parseInt(selectedToken?.externalDecimals || "18");
      const amountWei = safeParseUnits(amount || "0", decimals);
      const afterWei = maxAmountWei > amountWei ? maxAmountWei - amountWei : 0n;
      return { before: maxAmountWei.toString(), after: afterWei.toString() };
    } catch {
      return { before: "0", after: "0" };
    }
  }, [maxAmount, amount, selectedToken?.externalDecimals]);

  const formatBalanceDisplay = useCallback(
    (valueWei: string) => {
      const decimals = parseInt(selectedToken?.externalDecimals || "18");
      const num = Number(formatUnits(valueWei, decimals));
      return num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    },
    [selectedToken?.externalDecimals]
  );

  const isButtonDisabled = useMemo(
    () =>
      isLoading ||
      !hasValidAmount ||
      !selectedToken ||
      !isConnected ||
      !currentNetwork ||
      !isCorrectNetwork ||
      isBalanceLoading ||
      !isTokenPermitted,
    [
      isLoading,
      hasValidAmount,
      selectedToken,
      isConnected,
      currentNetwork,
      isCorrectNetwork,
      isBalanceLoading,
      isTokenPermitted,
    ]
  );

  // Effects
  useEffect(() => {
    if (!selectedNetwork && availableNetworks.length) {
      setSelectedNetwork(availableNetworks[0].chainName);
    }
    if (!selectedToken && currentTokens.length) {
      setSelectedToken(currentTokens[0]);
    } else if (
      selectedToken &&
      !currentTokens.some((t) => t.id === selectedToken.id)
    ) {
      setSelectedToken(currentTokens[0] || null);
    }
    setAmount("");
    setAmountError("");
  }, [
    availableNetworks,
    currentTokens,
    selectedNetwork,
    selectedToken,
    setSelectedNetwork,
    setSelectedToken,
  ]);

  useEffect(() => {
    if (selectedToken && currentNetwork) {
      fetchMinDepositAmount(selectedToken.externalToken, parseInt(selectedToken.externalDecimals || "18"));
    }
  }, [selectedToken]);

  useEffect(() => {
    setAmount("");
    setAmountError("");
    setMinDepositInfo({ 
      amount: "", 
      amountWei: 0n,
      loading: false
    });
  }, [isConvert]);

  useEffect(() => {
    const handleNetworkSwitch = async () => {
      if (!selectedNetwork || !isConnected || !expectedChainId) {
        setNetworkError("");
        return;
      }
      if (chainId !== expectedChainId) {
        setNetworkError(`Switching to ${selectedNetwork} network...`);
        try {
          await switchChain({ chainId: expectedChainId });
        } catch {
          setNetworkError(`Please switch to ${selectedNetwork}`);
        }
      } else {
        setNetworkError("");
      }
    };
    handleNetworkSwitch();
  }, [chainId, isConnected, selectedNetwork, expectedChainId, switchChain]);

  // Handlers
  const fetchMinDepositAmount = async (tokenAddress: string, decimals: number) => {
    if (!tokenAddress || !currentNetwork) return;
    
    setMinDepositInfo(prev => ({ ...prev, loading: true }));
    
    try {
      const tokenConfig = await getTokenConfig({
        tokenAddress,
        chainId: parseInt(currentNetwork.chainId),
        depositRouterAddress: currentNetwork.depositRouter,
      });

      const minAmountWei = tokenConfig.minAmount ? BigInt(tokenConfig.minAmount) : 0n;
      const formattedMinAmount = minAmountWei > 0n ? 
        formatBalance(minAmountWei, undefined, decimals) : "0";
      
      setMinDepositInfo({ 
        amount: formattedMinAmount, 
        amountWei: minAmountWei,
        loading: false
      });
      setIsTokenPermitted(tokenConfig.isPermitted);
    } catch {
      setMinDepositInfo({ 
        amount: "0", 
        amountWei: 0n,
        loading: false
      });
      setIsTokenPermitted(true);
    }
  };

  const handleAmountChange = useCallback(
    (value: string) => {
      const tokenDecimals = parseInt(selectedToken?.externalDecimals || "18");
      handleAmountInputChange(
        value,
        setAmount,
        setAmountError,
        maxAmount,
        tokenDecimals
      );
      
      if (value && minDepositInfo.amountWei > 0n) {
        const inputAmountWei = safeParseUnits(value, tokenDecimals);
        if (inputAmountWei < minDepositInfo.amountWei) {
          setAmountError(`Amount must be at least ${minDepositInfo.amount} ${selectedToken?.externalSymbol}`);
        }
      }
    },
    [maxAmount, selectedToken?.externalDecimals, selectedToken?.externalSymbol, minDepositInfo.amountWei, minDepositInfo.amount]
  );

  const ensureAllowanceOrPermit = async ({
    tokenAddress,
    owner,
    amount,
    chainId,
  }: {
    tokenAddress: string;
    owner: string;
    amount: bigint;
    chainId: string;
  }) => {
    const approval = await checkPermit2Approval({
      token: tokenAddress,
      owner,
      amount,
      chainId,
    });

    if (!approval.isApproved) {
      toast({
        title: "Approval Required",
        description: "Approving Permit2 to spend your tokens...",
      });

      const approveTx = await writeContractAsync({
        address: ensureHexPrefix(tokenAddress),
        abi: ERC20_ABI,
        functionName: "approve",
        args: [PERMIT2_ADDRESS as `0x${string}`, BigInt(2) ** BigInt(256) - BigInt(1)],
        chain: await resolveViemChain(chainId),
        account: owner as `0x${string}`,
      });

      await waitForTransaction(approveTx, chainId);
      toast({
        title: "Approval Successful",
        description: "Approval confirmed. Processing transaction...",
      });
    }
  };

  const buildPermit = async ({
    tokenAddress,
    amount,
    spender,
    chainId,
    owner,
  }: {
    tokenAddress: string;
    amount: bigint;
    spender: string;
    chainId: string;
    owner: string;
  }) => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const nonce = getPermit2Nonce();

    const signature = await signTypedDataAsync({
      domain: getPermit2Domain(chainId),
      types: getPermit2Types(),
      primaryType: "PermitTransferFrom",
      message: createPermit2Message({
        token: tokenAddress,
        amount,
        spender,
        nonce,
        deadline,
      }),
      account: owner as `0x${string}`,
    });

    return { signature, nonce, deadline };
  };

  const handleBridge = async () => {
    if (isLoading) return;

    if (!selectedToken || !amount || !isConnected || !isCorrectNetwork || !address || !userAddress || !currentNetwork) {
      toast({
        title: "Invalid configuration",
        description: "Please check your network, wallet connection, and token selection.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    toast({ title: "Waiting for confirmation", description: "Please confirm the transaction in your wallet" });

    try {
      const activeChainId = currentNetwork.chainId;
      const depositRouter = currentNetwork.depositRouter;
      const isNative = BigInt(selectedToken.externalToken || "0") === 0n;
      const depositAmount = safeParseUnits(
        amount,
        parseInt(selectedToken.externalDecimals || "18"),
      );

      const validation = await validateRouterContract({
        depositRouterAddress: depositRouter,
        amount,
        decimals: selectedToken.externalDecimals,
        chainId: activeChainId,
        tokenAddress: isNative ? NATIVE_TOKEN_ADDRESS : ensureHexPrefix(selectedToken.externalToken),
      });

      if (!validation.isValid) {
        throw new Error(validation.error || "Validation failed");
      }

      let permitData:
        | { signature: string; nonce: bigint; deadline: bigint }
        | undefined;
      if (!isNative) {
        await ensureAllowanceOrPermit({
          tokenAddress: selectedToken.externalToken,
          owner: address,
          amount: depositAmount,
          chainId: activeChainId,
        });
        permitData = await buildPermit({
          tokenAddress: selectedToken.externalToken,
          amount: depositAmount,
          spender: depositRouter,
          chainId: activeChainId,
          owner: address,
        });
      }

      await simulateDeposit({
        depositRouter,
        isNative,
        tokenAddress: isNative ? undefined : selectedToken.externalToken,
        amount: depositAmount,
        userAddress,
        account: address,
        chainId: activeChainId,
        permitData,
      });

      const chain = await resolveViemChain(activeChainId);

      let txHash: `0x${string}`;
      if (isNative) {
        txHash = await writeContractAsync({
          address: depositRouter as `0x${string}`,
          abi: DEPOSIT_ROUTER_ABI,
          functionName: "depositETH",
          args: [ensureHexPrefix(userAddress)],
          value: depositAmount,
          chain,
          account: address as `0x${string}`,
        });
      } else {
        if (!permitData) {
          throw new Error("Permit data is required for ERC20 deposits");
        }

        txHash = await writeContractAsync({
          address: depositRouter as `0x${string}`,
          abi: DEPOSIT_ROUTER_ABI,
          functionName: "deposit",
          args: [
            ensureHexPrefix(selectedToken.externalToken),
            depositAmount,
            ensureHexPrefix(userAddress),
            permitData.nonce,
            permitData.deadline,
            permitData.signature as `0x${string}`,
          ],
          chain,
          account: address as `0x${string}`,
        });
      }

      const explorerUrl = getExplorerUrl(activeChainId, txHash);
      toast({
        title: "Transaction Sent",
        description: (
          <div>
            <p>Transaction submitted: {formatTxHash(txHash)}</p>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline text-sm"
            >
              View on Explorer →
            </a>
          </div>
        ),
      });

      const success = await waitForTransaction(txHash, activeChainId);
      if (!success) {
        throw new Error("Transaction reverted");
      }

      toast({
        title: "Bridge Initiated",
        description:
          "Your deposit has been submitted successfully. The relayer will process it shortly.",
      });

      setAmount("");

      await Promise.all([
        isNative ? refetchNative() : refetchToken(),
        userAddress ? fetchUsdstBalance(userAddress) : Promise.resolve(),
        autoDeposit
          ? requestAutoSave({
              externalChainId: activeChainId,
              externalTxHash: txHash,
            })
          : Promise.resolve(),
      ]);
    } catch (error: any) {
      const bridgeError = normalizeError(error);
      toast({
        title: "Transaction Failed",
        description: bridgeError.userMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h3 className="text-lg font-semibold text-gray-900">
          {modeLabels.title}
        </h3>
        <p className="text-sm text-gray-600">{modeLabels.description}</p>
      </div>

      <div className="w-full">
        <BridgeWalletStatus />
      </div>

      <NetworkSelector
        selectedNetwork={selectedNetwork}
        availableNetworks={availableNetworks}
        onNetworkChange={setSelectedNetwork}
        direction="in"
        disabled={isLoading}
      />

      <TokenSelector
        selectedToken={selectedToken}
        tokens={currentTokens}
        onTokenChange={setSelectedToken}
        disabled={isLoading}
      />

      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label>Amount</Label>
          {maxAmount && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-500">
                Max: {formatBalance(
                  maxAmount,
                  undefined,
                  parseInt(selectedToken?.externalDecimals || "18"),
                  2,
                  parseInt(selectedToken?.externalDecimals || "18")
                )}
              </p>
              {selectedToken && currentNetwork && (
                <p className="text-sm text-gray-500">
                  Min: {minDepositInfo.amount || "0"}
                </p>
              )}
            </div>
          )}
        </div>
        <Input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          placeholder={isConnected ? "0.00" : "Connect wallet to enter amount"}
          className={`w-full ${
            amountError ? "border-red-500 focus:ring-red-400" : ""
          }`}
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          disabled={!isConnected || isLoading}
        />
        {amountError && <p className="text-sm text-red-500">{amountError}</p>}

        {isConnected && (
          <PercentageButtons
            value={amount}
            maxValue={maxAmount}
            onChange={handleAmountChange}
            decimals={parseInt(selectedToken?.externalDecimals || "18")}
            className="mt-2"
            disabled={isLoading}
          />
        )}
      </div>

      <DepositTransactionSummary
        selectedToken={selectedToken}
        amount={amount}
        amountError={amountError}
        balanceImpact={balanceImpact}
        formatBalanceDisplay={formatBalanceDisplay}
        savingRate={liquidityInfo?.supplyAPY}
        isConvert={isConvert}
      />

      {isConvert && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input 
            type="checkbox" 
            className="accent-blue-600" 
            checked={autoDeposit} 
            onChange={e => setAutoDeposit(e.target.checked)} 
          />
          Earn saving rate by offering USDST for lending
        </label>
      )}

      <Button
        onClick={handleBridge}
        disabled={isButtonDisabled}
        className="w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
      >
        {isLoading ? "Processing..." : isConvert && autoDeposit ? "Deposit and Earn" : "Deposit"}
      </Button>

      {networkError && (
        <p className="text-sm text-red-500">{networkError}</p>
      )}
    </div>
  );
};

export default BridgeIn;
