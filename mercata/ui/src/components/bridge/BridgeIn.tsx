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
import { useTokenContext } from "@/context/TokenContext";
import { useLendingContext } from "@/context/LendingContext";
import BridgeWalletStatus from "./BridgeWalletStatus";
import NetworkSelector from "./NetworkSelector";
import TokenSelector from "./TokenSelector";
import PercentageButtons from "@/components/ui/PercentageButtons";
import DepositTransactionSummary from "./DepositTransactionSummary";
import AdvancedOptionsDropdown from "./AdvancedOptionsDropdown";
import DepositProgressModal, { DepositStep } from "./DepositProgressModal";

interface BridgeInProps {
  isSaving?: boolean;
  guestMode?: boolean;
}

const BridgeIn: React.FC<BridgeInProps> = ({ isSaving = false, guestMode = false }) => {
  // Hooks & Context
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { fetchUsdstBalance } = useTokenContext();
  const { liquidityInfo } = useLendingContext();
  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
    requestAutoSave,
    triggerDepositRefresh,
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
  const [autoDeposit, setAutoDeposit] = useState(isSaving);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<DepositStep>("confirm_tx");
  const [progressTxHash, setProgressTxHash] = useState<string>();
  const [progressError, setProgressError] = useState<string>();
  const [progressIsNative, setProgressIsNative] = useState(true);

  // Computed values
  const modeLabels = BRIDGE_IN_MODE_LABELS[isSaving ? "easy-savings" : "bridge"];

  const currentTokens = useMemo(() => {
    return bridgeableTokens.filter((token) =>
      isSaving ? !token.isDefaultRoute : token.isDefaultRoute
    );
  }, [bridgeableTokens, isSaving]);

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
      guestMode ||
      isLoading ||
      !hasValidAmount ||
      !selectedToken ||
      !isConnected ||
      !currentNetwork ||
      !isCorrectNetwork ||
      isBalanceLoading ||
      !isTokenPermitted,
    [
      guestMode,
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
    setAutoDeposit(isSaving);
  }, [isSaving]);

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
    setProgressError(undefined);
    
    // Determine if native token before opening modal
    const isNative = BigInt(selectedToken.externalToken || "0") === 0n;
    setProgressIsNative(isNative);
    
    setProgressModalOpen(true);

    try {
      const activeChainId = currentNetwork.chainId;
      const depositRouter = currentNetwork.depositRouter;
      const targetStratoToken = ensureHexPrefix(selectedToken.stratoToken);
      
      // Set initial step based on whether it's Easy Savings or Bridge In, and if it needs approval
      if (!isNative) {
        // ERC20 tokens need approval for both Easy Savings and Bridge In
        setCurrentStep("approve");
      } else {
        // Native tokens (ETH) go straight to confirm
        setCurrentStep("confirm_tx");
      }
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
        targetStratoToken,
      });

      if (!validation.isValid) {
        throw new Error(validation.error || "Validation failed");
      }

      let permitData:
        | { signature: string; nonce: bigint; deadline: bigint }
        | undefined;
      if (!isNative) {
        // Step: Approve Token (for both Easy Savings and Bridge In with ERC20 tokens)
        setCurrentStep("approve");
        
        const approval = await checkPermit2Approval({
          token: selectedToken.externalToken,
          owner: address,
          amount: depositAmount,
          chainId: activeChainId,
        });

        if (!approval.isApproved) {
          toast({
            title: "Approval Required",
            description: "Approving Permit2 to spend your tokens...",
          });

          const approveTx = await writeContractAsync({
            address: ensureHexPrefix(selectedToken.externalToken),
            abi: ERC20_ABI,
            functionName: "approve",
            args: [PERMIT2_ADDRESS as `0x${string}`, BigInt(2) ** BigInt(256) - BigInt(1)],
            chain: await resolveViemChain(activeChainId),
            account: address as `0x${string}`,
          });

          await waitForTransaction(approveTx, activeChainId);
          
          toast({
            title: "Approval Successful",
            description: "Approval confirmed. Processing transaction...",
          });
        }
        
        // Move to sign_permit step after approval completes (or if already approved)
        // This ensures the "approve" step shows as completed (green) before moving to sign_permit
        setCurrentStep("sign_permit");
        
        // Build permit (this involves message signing, not a transaction)
        permitData = await buildPermit({
          tokenAddress: selectedToken.externalToken,
          amount: depositAmount,
          spender: depositRouter,
          chainId: activeChainId,
          owner: address,
        });
        
        // Move to confirm_tx step after permit is signed
        setCurrentStep("confirm_tx");
      }

      await simulateDeposit({
        depositRouter,
        isNative,
        tokenAddress: isNative ? undefined : selectedToken.externalToken,
        amount: depositAmount,
        userAddress,
        targetStratoToken,
        account: address,
        chainId: activeChainId,
        permitData,
      });

      // Step: Confirm Transaction (for native tokens, this is already set above)
      if (isNative && currentStep !== "confirm_tx") {
        setCurrentStep("confirm_tx");
      }
      const chain = await resolveViemChain(activeChainId);

      let txHash: `0x${string}`;
      if (isNative) {
        txHash = await writeContractAsync({
          address: depositRouter as `0x${string}`,
        abi: DEPOSIT_ROUTER_ABI,
        functionName: "depositETH",
          args: [ensureHexPrefix(userAddress), targetStratoToken],
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
            targetStratoToken,
            permitData.nonce,
            permitData.deadline,
            permitData.signature as `0x${string}`,
        ],
        chain,
          account: address as `0x${string}`,
      });
      }

      setProgressTxHash(txHash);
      
      // Step: Waiting for Transaction
      setCurrentStep("waiting_tx");
      const success = await waitForTransaction(txHash, activeChainId);
      if (!success) {
        throw new Error(`Transaction reverted on ${selectedNetwork} network. No funds were deposited on STRATO. Please try again.`);
      }

      const externalDecimals = parseInt(selectedToken.externalDecimals || "18");
      const decimalDiff = 18 - externalDecimals;
      const amount18Decimals = decimalDiff >= 0 
        ? (depositAmount * BigInt(10 ** decimalDiff)).toString()
        : depositAmount.toString();

      const existing = JSON.parse(localStorage.getItem('pendingDeposits') || '[]');
      existing.push({
        externalChainId: parseInt(activeChainId),
        externalTxHash: txHash,
        type: isSaving ? 'saving' : 'bridge',
        DepositInfo: {
          externalSender: address,
          stratoRecipient: userAddress,
          stratoToken: selectedToken.stratoToken,
          stratoTokenAmount: amount18Decimals,
          bridgeStatus: "1",
        },
        block_timestamp: new Date().toISOString(),
        stratoTokenSymbol: selectedToken.stratoTokenSymbol,
        externalName: selectedToken.externalName,
        externalSymbol: selectedToken.externalSymbol,
      });
      localStorage.setItem('pendingDeposits', JSON.stringify(existing));
      triggerDepositRefresh();

      // Step: Waiting for Autosave (if Easy Savings) or Complete
      if (autoDeposit) {
        setCurrentStep("waiting_autosave");
        await requestAutoSave({
          externalChainId: activeChainId,
          externalTxHash: txHash,
        });
      }

      // Step: Complete
      setCurrentStep("complete");
      setAmount("");

      await Promise.all([
        isNative ? refetchNative() : refetchToken(),
        fetchUsdstBalance(),
      ]);
    } catch (error: any) {
      const bridgeError = normalizeError(error);
      setCurrentStep("error");
      setProgressError(bridgeError.userMessage);
      toast({
        title: "Transaction Failed",
        description: bridgeError.userMessage,
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h3 className="text-lg font-semibold text-foreground">
          {modeLabels.title}
        </h3>
        <p className="text-sm text-muted-foreground">{modeLabels.description}</p>
      </div>

      <div className="w-full">
        <BridgeWalletStatus guestMode={guestMode} />
      </div>

      <TokenSelector
        selectedToken={selectedToken}
        tokens={currentTokens}
        onTokenChange={setSelectedToken}
        disabled={guestMode || isLoading}
      />

      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
        <Label>Amount</Label>
          {maxAmount && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Max: {formatBalance(
                  maxAmount,
                  undefined,
                  parseInt(selectedToken?.externalDecimals || "18"),
                  2,
                  parseInt(selectedToken?.externalDecimals || "18")
                )}
              </p>
              {selectedToken && currentNetwork && (
                <p className="text-sm text-muted-foreground">
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
          disabled={guestMode || !isConnected || isLoading}
        />
        {amountError && <p className="text-sm text-red-500">{amountError}</p>}
        
        {isConnected && (
          <PercentageButtons
            value={amount}
            maxValue={maxAmount}
            onChange={handleAmountChange}
            decimals={parseInt(selectedToken?.externalDecimals || "18")}
            className="mt-2"
            disabled={guestMode || isLoading}
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
        isSaving={isSaving}
        autoDeposit={autoDeposit}
      />

      {isSaving && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input 
            type="checkbox" 
            className="accent-blue-600" 
            checked={autoDeposit} 
            onChange={e => setAutoDeposit(e.target.checked)}
            disabled={guestMode}
          />
          Earn saving rate by offering USDST for lending
        </label>
      )}

        <Button
          onClick={handleBridge}
        disabled={isButtonDisabled}
        className="w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
        {isLoading ? "Processing..." : isSaving && autoDeposit ? "Deposit and Earn" : "Deposit"}
        </Button>

      <AdvancedOptionsDropdown
        selectedNetwork={selectedNetwork}
        availableNetworks={availableNetworks}
        onNetworkChange={setSelectedNetwork}
        direction="in"
        disabled={isLoading}
      />

      {networkError && (
        <p className="text-sm text-red-500">{networkError}</p>
      )}

      <DepositProgressModal
        open={progressModalOpen}
        currentStep={currentStep}
        txHash={progressTxHash}
        chainId={currentNetwork?.chainId ? parseInt(currentNetwork.chainId) : undefined}
        isEasySavings={isSaving && autoDeposit}
        isNative={progressIsNative}
        error={progressError}
        onClose={() => {
          setProgressModalOpen(false);
          setCurrentStep("confirm_tx");
          setProgressTxHash(undefined);
          setProgressError(undefined);
        }}
      />
    </div>
  );
};

export default BridgeIn;
