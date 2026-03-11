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
} from "@/lib/bridge/utils";
import { ensureHexPrefix, formatBalance, safeParseUnits, formatUnits } from "@/utils/numberUtils";
import { handleAmountInputChange } from "@/utils/transferValidation";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useLendingContext } from "@/context/LendingContext";
import BridgeWalletStatus from "./BridgeWalletStatus";
import TokenSelector from "./TokenSelector";
import PercentageButtons from "@/components/ui/PercentageButtons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import DepositTransactionSummary from "./DepositTransactionSummary";
import AdvancedOptionsDropdown from "./AdvancedOptionsDropdown";
import DepositProgressModal, { DepositStep } from "./DepositProgressModal";
import { redirectToLogin } from "@/lib/auth";
import { Link } from "react-router-dom";
import { ArrowDownToLine, CreditCard, CheckCircle2, Info } from "lucide-react";

interface BridgeInProps {
  isSaving?: boolean;
  guestMode?: boolean;
  isFundPage?: boolean;
}

const BridgeIn: React.FC<BridgeInProps> = ({ isSaving = false, guestMode = false, isFundPage = false }) => {
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

  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefetchingBalance, setIsRefetchingBalance] = useState(false);
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

  const modeLabels = BRIDGE_IN_MODE_LABELS[isSaving ? "easy-savings" : "bridge"];
  const prevRouteCountRef = React.useRef<number>(1);

  const currentTokens = useMemo(() => {
    if (isFundPage) return bridgeableTokens;
    return bridgeableTokens.filter((token) =>
      isSaving ? !token.isDefaultRoute : token.isDefaultRoute
    );
  }, [bridgeableTokens, isSaving, isFundPage]);

  const currentNetwork = useMemo(() => {
    return availableNetworks.find((n) => n.chainName === selectedNetwork) || null;
  }, [availableNetworks, selectedNetwork]);

  const sourceTokenRoutes = useMemo(() => {
    if (!selectedToken) return [];
    const routes = currentTokens.filter((token) =>
      token.externalToken?.toLowerCase() === selectedToken.externalToken?.toLowerCase()
    );
    if (routes.length > 0) prevRouteCountRef.current = routes.length;
    return routes;
  }, [currentTokens, selectedToken]);

  const uniqueExternalTokens = useMemo(() => {
    const seen = new Set<string>();
    return currentTokens.filter((token) => {
      const key = (token.externalToken || "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [currentTokens]);

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
        maximumFractionDigits: 6,
      });
    },
    [selectedToken?.externalDecimals]
  );

  const disabledReasons = useMemo(() => {
    const reasons: string[] = [];
    if (guestMode) reasons.push("guestMode");
    if (isLoading) reasons.push("isLoading");
    if (!hasValidAmount) {
      reasons.push(amountError ? `amountError:${amountError}` : "emptyOrInvalidAmount");
    }
    if (!selectedToken) reasons.push("noSelectedToken");
    if (!isConnected) reasons.push("walletNotConnected");
    if (!currentNetwork) reasons.push("noCurrentNetwork");
    if (!isCorrectNetwork) {
      reasons.push(`wrongNetwork(active:${chainId ?? "n/a"}, expected:${expectedChainId ?? "n/a"})`);
    }
    if (isBalanceLoading) reasons.push("balanceLoading");
    if (!isTokenPermitted) reasons.push("tokenNotPermitted");
    return reasons;
  }, [
    guestMode,
    isLoading,
    hasValidAmount,
    amountError,
    selectedToken,
    isConnected,
    currentNetwork,
    isCorrectNetwork,
    isBalanceLoading,
    isTokenPermitted,
    chainId,
    expectedChainId,
  ]);

  const isButtonDisabled = disabledReasons.length > 0;

  const prevExternalTokenRef = React.useRef<string | null>(null);

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

    const currentExternal = (selectedToken?.externalToken || "").toLowerCase();
    const prevExternal = prevExternalTokenRef.current;
    if (prevExternal !== null && prevExternal !== currentExternal) {
      setAmount("");
      setAmountError("");
    }
    prevExternalTokenRef.current = currentExternal;
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
  }, [selectedToken]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (!amount) return;
    console.log("[BridgeIn] Deposit button state", {
      disabled: isButtonDisabled,
      reasons: disabledReasons,
      amount,
      amountError,
      selectedTokenId: selectedToken?.id,
      externalToken: selectedToken?.externalToken,
      stratoToken: selectedToken?.stratoToken,
      isTokenPermitted,
      isBalanceLoading,
      isConnected,
      isCorrectNetwork,
      activeChainId: chainId,
      expectedChainId,
      selectedNetwork,
    });
  }, [
    amount,
    amountError,
    isButtonDisabled,
    disabledReasons,
    selectedToken,
    isTokenPermitted,
    isBalanceLoading,
    isConnected,
    isCorrectNetwork,
    chainId,
    expectedChainId,
    selectedNetwork,
  ]);

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
    
    const isNative = BigInt(selectedToken.externalToken || "0") === 0n;
    setProgressIsNative(isNative);
    
    setProgressModalOpen(true);

    try {
      const activeChainId = currentNetwork.chainId;
      const depositRouter = currentNetwork.depositRouter;
      const targetStratoToken = ensureHexPrefix(selectedToken.stratoToken);
      
      if (!isNative) {
        setCurrentStep("approve");
      } else {
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
        
        setCurrentStep("sign_permit");
        
        permitData = await buildPermit({
          tokenAddress: selectedToken.externalToken,
          amount: depositAmount,
          spender: depositRouter,
          chainId: activeChainId,
          owner: address,
        });
        
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

      if (autoDeposit) {
        setCurrentStep("waiting_autosave");
        await requestAutoSave({
          externalChainId: activeChainId,
          externalTxHash: txHash,
        });
      }

      setCurrentStep("complete");
      setAmount("");

      setIsRefetchingBalance(true);
      const refetchBalance = () => Promise.all([
        isNative ? refetchNative() : refetchToken(),
        fetchUsdstBalance(),
      ]);
      await new Promise((r) => setTimeout(r, 2000));
      await refetchBalance();
      setTimeout(() => {
        refetchBalance().finally(() => setIsRefetchingBalance(false));
      }, 5000);
    } catch (error: unknown) {
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

  const networkNames = availableNetworks.map((n) => n.chainName).join(" or ");
  const depositSummaryText = selectedToken && amount
    ? `Deposit ${amount} ${selectedToken.externalSymbol} \u2192 ${amount} ${selectedToken.stratoTokenSymbol}`
    : null;

  const fundTokenLabel = (token: { externalSymbol?: string; externalName?: string } | null): string => {
    if (!token) return "Select asset";
    return token.externalSymbol || token.externalName || "Select asset";
  };
  
  if (isFundPage) {
    return (
      <div className="space-y-7">
        {/* STEP 1 */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">1</span>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How Are You Funding?</h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { if (guestMode) redirectToLogin(); }}
              className="relative rounded-md border-2 border-blue-500 bg-blue-500/5 dark:bg-blue-500/10 p-3 text-left"
            >
              <div className="absolute top-2 right-2">
                <CheckCircle2 className="w-5 h-5 text-blue-500" />
              </div>
              <ArrowDownToLine className="w-5 h-5 text-blue-500 mb-2" />
              <p className="text-sm font-semibold">{guestMode ? "Connect" : "Bridge In"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">From {networkNames}</p>
            </button>
            <button
              type="button"
              disabled
              className="rounded-md border-2 border-border p-3 text-left opacity-40 cursor-not-allowed"
            >
              <CreditCard className="w-5 h-5 text-muted-foreground mb-2" />
              <p className="text-sm font-semibold">Buy Crypto</p>
              <p className="text-xs text-muted-foreground mt-0.5">With card or bank transfer</p>
            </button>
          </div>

          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${availableNetworks.length || 1}, 1fr)` }}>
            {availableNetworks.map((network) => {
              const active = selectedNetwork === network.chainName;
              return (
                <button
                  key={network.chainId}
                  type="button"
                  onClick={() => setSelectedNetwork(network.chainName)}
                  disabled={guestMode || isLoading}
                  className={`relative h-10 rounded-md text-sm font-medium border-2 transition-colors flex items-center justify-center ${
                    active
                      ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-300"
                      : "border-border text-foreground hover:bg-muted/50"
                  }`}
                >
                  {active && (
                    <div className="absolute top-1 right-1">
                      <CheckCircle2 className="w-4 h-4 text-blue-500" />
                    </div>
                  )}
                  {network.chainName}
                </button>
              );
            })}
          </div>
        </section>

        {/* STEP 2 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">2</span>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">You Send</h3>
            </div>
            <div className="flex items-center gap-2">
              <div className="fund-wallet-compact [&_>div]:!mb-0 [&_.group>div]:!h-7 [&_.group>div]:!text-[11px] [&_.group>div]:!px-2.5 [&_.group>div]:!rounded-md [&_.group>div.absolute]:!rounded-md [&_.group>div.absolute>span]:!text-[11px] [&_button]:!h-7 [&_button]:!text-[11px] [&_button]:!px-2.5 [&_button]:!py-0 [&_button]:!rounded-md [&_button]:!font-medium">
                <style>{`.fund-wallet-compact > div > div.flex { gap: 0 !important; } .fund-wallet-compact > div > div.flex > :not(.group) { display: none !important; } .fund-wallet-compact > div { width: auto !important; }`}</style>
                <BridgeWalletStatus guestMode={guestMode} />
              </div>
              {isConnected && address && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground font-mono hover:text-foreground transition-colors"
                  onClick={() => {
                    navigator.clipboard.writeText(address);
                    toast({ title: "Copied", description: "Address copied to clipboard", duration: 1500 });
                  }}
                >
                  {address.slice(0, 6)}...{address.slice(-4)}
                </button>
              )}
            </div>
          </div>

          <div className="rounded-md border-2 border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Select
                value={(selectedToken?.externalToken || "").toLowerCase()}
                onValueChange={(val) => {
                  const match = currentTokens.find(
                    (t) => (t.externalToken || "").toLowerCase() === val && t.isDefaultRoute
                  ) || currentTokens.find(
                    (t) => (t.externalToken || "").toLowerCase() === val
                  ) || null;
                  setSelectedToken(match);
                  if (match?.isDefaultRoute) setAutoDeposit(false);
                }}
                disabled={!uniqueExternalTokens.length || guestMode || isLoading}
              >
                <SelectTrigger className="h-10 w-auto min-w-0 shrink-0 gap-1 rounded-md border-border text-sm font-semibold text-foreground px-2">
                  <SelectValue placeholder="Token" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueExternalTokens
                    .filter((t) => t.externalSymbol || t.externalName)
                    .map((t) => (
                      <SelectItem key={t.externalToken} value={(t.externalToken || "").toLowerCase()}>
                        {fundTokenLabel(t)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0.00"
                className={`flex-1 h-10 text-right text-xl font-bold text-foreground border-0 focus-visible:ring-0 p-0 ${amountError ? "!text-red-500" : ""}`}
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                disabled={guestMode || !isConnected || isLoading}
              />
            </div>
            {amountError && <p className="text-xs text-red-500">{amountError}</p>}

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                Balance:{" "}
                {isRefetchingBalance ? (
                  <span className="inline-block w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin align-middle ml-1" />
                ) : (
                  <span className="text-foreground font-medium">{formatBalanceDisplay(maxAmount)} {selectedToken?.externalSymbol || ""}</span>
                )}
              </span>
              {isConnected && (
                <div className="flex items-center gap-1">
                  <PercentageButtons
                    value={amount}
                    maxValue={maxAmount}
                    onChange={handleAmountChange}
                    decimals={parseInt(selectedToken?.externalDecimals || "18")}
                    disabled={guestMode || isLoading}
                    className="[&_button]:!h-6 [&_button]:!px-2 [&_button]:!text-[10px] [&_button]:!min-w-0 [&_button:not(.border-blue-500)]:!text-muted-foreground"
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* STEP 3 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">3</span>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">You Receive On STRATO</h3>
            </div>
            <div className={`flex items-center gap-1.5 ${
              selectedToken && !selectedToken.isDefaultRoute
                ? "opacity-100"
                : "opacity-40 pointer-events-none"
            }`}>
              <Switch
                checked={autoDeposit}
                onCheckedChange={setAutoDeposit}
                disabled={guestMode || !selectedToken || selectedToken.isDefaultRoute}
                className="h-4 w-7 data-[state=checked]:bg-blue-500 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
              />
              <span className="text-[11px] text-muted-foreground">Auto-deposit</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[200px] text-xs">
                  Automatically deposits your received tokens into the lending pool to start earning yield.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min((sourceTokenRoutes.length || prevRouteCountRef.current), 3)}, 1fr)` }}>
            {sourceTokenRoutes.length > 0 ? (
              sourceTokenRoutes.map((routeToken) => {
                const active = routeToken.id === selectedToken?.id;
                const routeType = routeToken.isDefaultRoute ? "VIA WRAP" : "VIA MINT";
                return (
                  <button
                    key={routeToken.id}
                    type="button"
                    onClick={() => { setSelectedToken(routeToken); if (routeToken.isDefaultRoute) setAutoDeposit(false); }}
                    disabled={guestMode || isLoading}
                    className={`relative text-left rounded-md border-2 p-3 transition-colors ${
                      active
                        ? "border-blue-500 bg-blue-500/5 dark:bg-blue-500/10"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    {active && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle2 className="w-4 h-4 text-blue-500" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      {routeToken.stratoTokenImage ? (
                        <img src={routeToken.stratoTokenImage} alt={routeToken.stratoTokenSymbol} className="w-6 h-6 rounded-full object-cover shrink-0" />
                      ) : (
                        <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-foreground shrink-0">
                          {(routeToken.stratoTokenSymbol || "?").charAt(0)}
                        </span>
                      )}
                      <p className="text-sm font-semibold text-foreground">{routeToken.stratoTokenSymbol}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {"\u2248"} {amount || "0"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">{routeType}</p>
                  </button>
                );
              })
            ) : (
              Array.from({ length: prevRouteCountRef.current }).map((_, i) => (
                <div key={`skeleton-${i}`} className="relative text-left rounded-md border-2 border-border p-3 animate-pulse">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-full bg-muted shrink-0" />
                    <div className="h-[1.25rem] w-16 bg-muted rounded" />
                  </div>
                  <div className="h-[1rem] w-12 bg-muted rounded" />
                  <div className="h-[0.875rem] w-14 bg-muted rounded mt-1" />
                </div>
              ))
            )}
          </div>
        </section>

        <div className="space-y-2">
          <Button
            onClick={handleBridge}
            disabled={isButtonDisabled}
            className="w-full h-11 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 text-base font-semibold"
          >
            {isLoading ? "Processing..." : "Deposit"}
          </Button>
          <div className="text-right">
            <Link to="/dashboard/withdrawals" className="text-xs text-blue-500 hover:text-blue-400">
              Need to withdraw? <span className="font-semibold">Withdraw {"\u2192"}</span>
            </Link>
          </div>
        </div>

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
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground text-center">
          {modeLabels.title}
        </h3>
        <p className="text-sm text-muted-foreground text-center">{modeLabels.description}</p>
      </div>

      <div className="w-full">
        <BridgeWalletStatus guestMode={guestMode} />
      </div>

      <TokenSelector
        selectedToken={selectedToken}
        tokens={currentTokens}
        onTokenChange={setSelectedToken}
        direction="in"
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
          className={`w-full ${amountError ? "border-red-500 focus:ring-red-400" : ""}`}
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
