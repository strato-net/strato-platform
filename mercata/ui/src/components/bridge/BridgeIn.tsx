import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApySource, DepositAction } from "@mercata/shared-types";
import { metalForgeService, MetalConfig, PayTokenConfig } from "@/services/metalForgeService";
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
import { normalizeError } from "@/lib/bridge/utils";
import { ensureHexPrefix, formatBalance, safeParseUnits, formatUnits } from "@/utils/numberUtils";
import { handleAmountInputChange, computeMaxTransferable } from "@/utils/transferValidation";
import { useBridgeContext } from "@/context/BridgeContext";
import { useEarnContext } from "@/context/EarnContext";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import BridgeWalletStatus from "./BridgeWalletStatus";
import PercentageButtons from "@/components/ui/PercentageButtons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DepositProgressModal, { DepositStep } from "./DepositProgressModal";
import { redirectToLogin } from "@/lib/auth";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDownToLine, Gem, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { usdstAddress, WAD, METAL_BUY_FEE } from "@/lib/constants";

const METAL_BUY_FEE_WEI = safeParseUnits(METAL_BUY_FEE).toString();

/** Step 3 card APY row: fixed slot so cards match height with/without APY and vs skeleton */
const STEP3_APY_ROW_CLASS = "mt-0.5 flex min-h-[18px] items-center";

const normAddr = (a: string) => (a || "").toLowerCase().replace(/^0x/, "");

const apySourceDisplay = (a: ApySource): string => {
  switch (a.source) {
    case "lending":
      return "Lending pool";
    case "swap":
      return "Swap pool";
    case "vault":
      return "Vault";
    case "safety":
      return "Safety module";
    default:
      return a.source;
  }
};

const pathForApyInfo = (info: { source: ApySource["source"]; poolAddress?: string }): string => {
  switch (info.source) {
    case "lending":
      return "/dashboard/earn-lending";
    case "vault":
      return "/dashboard/earn-vault";
    case "swap":
      return info.poolAddress ? `/dashboard/earn-pools?pool=${info.poolAddress}` : "/dashboard/earn-pools";
    case "safety":
      return "/dashboard/advanced?tab=safety";
    default:
      return "/dashboard/earn";
  }
};

const calcMetalAmount = (payAmount: string, metal: MetalConfig, payToken: PayTokenConfig): bigint => {
  try {
    const input = safeParseUnits(payAmount, 18);
    const principal = input - (input * BigInt(metal.feeBps || "0") / 10000n);
    const fundsUSD = (principal * BigInt(payToken.price || "0")) / WAD;
    const metalPrice = BigInt(metal.price);
    return metalPrice > 0n ? (fundsUSD * WAD) / metalPrice : 0n;
  } catch { return 0n; }
};

const CrossfadePanel = ({ active, children }: { active: boolean; children: React.ReactNode }) => (
  <div className={`transition-opacity duration-300 ${active ? "opacity-100" : "opacity-0 absolute inset-0 pointer-events-none"}`}>
    {children}
  </div>
);

const CardSkeleton = ({ id }: { id: string }) => (
  <div key={id} className="relative text-left rounded-md border-2 border-border p-3 animate-pulse snap-start">
    <div className="flex items-center gap-2 mb-1">
      <div className="w-6 h-6 rounded-full bg-muted shrink-0" />
      <div className="h-[1.25rem] w-16 bg-muted rounded" />
    </div>
    <div className="h-[1rem] w-12 bg-muted rounded" />
    <div className={STEP3_APY_ROW_CLASS}>
      <div className="h-2.5 w-16 bg-muted/50 rounded" />
    </div>
    <div className="h-[0.875rem] w-14 bg-muted rounded mt-1" />
  </div>
);

const TokenCard = ({ active, image, symbol, estimated, label, onClick, disabled, apyBadge }: {
  active: boolean; image?: string; symbol: string; estimated: string;
  label: string; onClick: () => void; disabled: boolean;
  apyBadge: React.ReactNode;
}) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className={`relative text-left rounded-md border-2 p-3 transition-colors snap-start ${
      active ? "border-blue-500 bg-blue-500/5 dark:bg-blue-500/10" : "border-border hover:bg-muted/30"
    }`}>
    {active && <div className="absolute top-2 right-2"><CheckCircle2 className="w-4 h-4 text-blue-500" /></div>}
    <div className="flex items-center gap-2 mb-1">
      {image
        ? <img src={image} alt={symbol} className="w-6 h-6 rounded-full object-cover shrink-0" />
        : <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-foreground shrink-0">{(symbol || "?").charAt(0)}</span>}
      <p className="text-sm font-semibold text-foreground">{symbol}</p>
    </div>
    <p className="text-xs text-muted-foreground">{"\u2248"} {estimated}</p>
    {apyBadge}
    {label ? <p className="text-[10px] text-muted-foreground mt-1">{label}</p> : null}
  </button>
);

const ScrollRow = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const count = React.Children.count(children);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    if (count <= 3) return;
    check();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [check, count]);

  const scroll = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.floor(el.clientWidth / 3), behavior: "smooth" });
  };

  const needsScroll = count > 3;
  const gridStyle: React.CSSProperties = needsScroll
    ? {
        gridTemplateColumns: `repeat(${count}, calc((100% - 16px) / 3))`,
        overflowX: "auto",
        scrollbarWidth: "none",
      }
    : {
        gridTemplateColumns: `repeat(${count || 1}, minmax(0, 1fr))`,
      };

  return (
    <div className="relative group">
      <div ref={ref} className="grid gap-2 snap-x" style={gridStyle}>
        {children}
      </div>
      {needsScroll && ([
        { dir: -1, enabled: canLeft, pos: "left-0", grad: "bg-gradient-to-r", Icon: ChevronLeft },
        { dir: 1, enabled: canRight, pos: "right-0", grad: "bg-gradient-to-l", Icon: ChevronRight },
      ] as const).map(({ dir, enabled, pos, grad, Icon }) => (
        <button key={dir} type="button" onClick={() => scroll(dir)} disabled={!enabled}
          className={`absolute ${pos} top-0 bottom-0 w-7 flex items-center justify-center ${grad} from-card to-transparent z-10 transition-opacity ${enabled ? "opacity-100" : "opacity-30 pointer-events-none"}`}>
          <Icon className="w-4 h-4 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
};

interface BridgeInProps {
  guestMode?: boolean;
  fundingMode?: "bridge" | "metals";
  onFundingModeChange?: (mode: "bridge" | "metals") => void;
  onMetalPurchase?: () => void;
}

const BridgeIn: React.FC<BridgeInProps> = ({ guestMode = false, fundingMode: externalFundingMode, onFundingModeChange, onMetalPurchase }) => {
  // Hooks & Context
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { fetchUsdstBalance, usdstBalance, voucherBalance } = useTokenContext();
  const { activeTokens, fetchTokens } = useUserTokens();
  const {
    availableNetworks,
    bridgeableTokens,
    depositActions,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
    requestDepositAction,
    triggerDepositRefresh,
  } = useBridgeContext();
  const { tokenApys, tokenApysLoaded } = useEarnContext();
  const navigate = useNavigate();

  // State -- fundingMode can be controlled externally or managed internally
  const [internalMode, setInternalMode] = useState<"bridge" | "metals">("bridge");
  const fundingMode = externalFundingMode ?? internalMode;
  const setFundingMode = onFundingModeChange ?? setInternalMode;
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
  const [selectedAction, setSelectedAction] = useState<DepositAction | null>(null);
  const [metalsConfig, setMetalsConfig] = useState<{ metals: MetalConfig[]; payTokens: PayTokenConfig[] } | null>(null);
  const [selectedPayToken, setSelectedPayToken] = useState<PayTokenConfig | null>(null);
  const [selectedMetal, setSelectedMetal] = useState<MetalConfig | null>(null);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<DepositStep>("confirm_tx");
  const [progressTxHash, setProgressTxHash] = useState<string>();
  const [progressError, setProgressError] = useState<string>();
  const [progressIsNative, setProgressIsNative] = useState(true);
  const [metalsFeeError, setMetalsFeeError] = useState("");

  const prevRouteCountRef = React.useRef<number>(1);
  const prevCardsRef = React.useRef<{ routes: typeof bridgeableTokens; actions: typeof depositActions }>({ routes: [], actions: [] });
  const prevExternalTokenRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (fundingMode !== "metals" || metalsConfig) return;
    metalForgeService.getConfigs().then(cfg => {
      setMetalsConfig(cfg);
      const enabledMetals = cfg.metals.filter(m => m.isEnabled);
      if (cfg.payTokens.length) setSelectedPayToken(cfg.payTokens[0]);
      if (enabledMetals.length) setSelectedMetal(enabledMetals[0]);
    }).catch(() => {});
  }, [fundingMode]);

  // Computed values
  const currentNetwork = useMemo(() => {
    return availableNetworks.find((n) => n.chainName === selectedNetwork) || null;
  }, [availableNetworks, selectedNetwork]);

  const { sourceTokenRoutes, matchingActions } = useMemo(() => {
    if (!selectedToken) return { sourceTokenRoutes: prevCardsRef.current.routes, matchingActions: prevCardsRef.current.actions };
    const routes = bridgeableTokens.filter((token) =>
      token.externalToken?.toLowerCase() === selectedToken.externalToken?.toLowerCase()
    );
    if (routes.length > 0) prevRouteCountRef.current = routes.length;
    const mintStratoTokens = new Set(routes.filter(r => !r.isDefaultRoute).map(r => normAddr(r.stratoToken)));
    const actions = depositActions.filter(a => a.payToken && mintStratoTokens.has(normAddr(a.payToken)));
    if (routes.length > 0) prevCardsRef.current = { routes, actions };
    return { sourceTokenRoutes: routes.length > 0 ? routes : prevCardsRef.current.routes, matchingActions: routes.length > 0 ? actions : prevCardsRef.current.actions };
  }, [bridgeableTokens, selectedToken, depositActions]);

  const getApyInfo = useMemo(() => {
    const m = new Map<string, { apy: string; sourceLabel: string; source: ApySource["source"]; poolAddress?: string }>();
    for (const entry of tokenApys) {
      let best: ApySource | null = null;
      for (const a of entry.apys) {
        if (!best || parseFloat(a.apy) > parseFloat(best.apy)) best = a;
      }
      if (best && parseFloat(best.apy) > 0) {
        m.set(normAddr(entry.token), {
          apy: best.apy,
          sourceLabel: apySourceDisplay(best),
          source: best.source,
          poolAddress: best.poolAddress,
        });
      }
    }
    return (addr: string) => m.get(normAddr(addr));
  }, [tokenApys]);

  const ApyLine = ({ addr }: { addr: string }) => {
    const info = tokenApysLoaded ? getApyInfo(addr) : null;
    const go = () => {
      if (!info) return;
      navigate(pathForApyInfo(info));
    };
    return (
      <div className={STEP3_APY_ROW_CLASS}>
        {!tokenApysLoaded ? (
          <p className="text-[10px] font-medium text-green-500/40 animate-pulse blur-[2px] leading-none">{"\u2026"}</p>
        ) : info ? (
          <span
            role="link"
            tabIndex={0}
            className="text-[10px] font-medium leading-snug text-green-500 cursor-pointer hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              go();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              go();
            }}
          >
            {`Get ${info.apy}% via ${info.sourceLabel}`}
          </span>
        ) : null}
      </div>
    );
  };

  const metalsPayBalanceWei = useMemo(() => {
    if (!selectedPayToken) return "0";
    const tok = activeTokens.find((t: any) => normAddr(t.address) === normAddr(selectedPayToken.address));
    return tok?.balance || "0";
  }, [selectedPayToken, activeTokens]);

  const metalsMaxAmount = useMemo(() => computeMaxTransferable(
    metalsPayBalanceWei,
    normAddr(selectedPayToken?.address || "") === normAddr(usdstAddress),
    voucherBalance, usdstBalance, METAL_BUY_FEE_WEI, setMetalsFeeError
  ), [metalsPayBalanceWei, selectedPayToken?.address, voucherBalance, usdstBalance]);

  const metalsPayBalance = useMemo(() => {
    return metalsPayBalanceWei !== "0" ? formatBalance(metalsPayBalanceWei) : "0.00";
  }, [metalsPayBalanceWei]);

  const uniqueExternalTokens = useMemo(() => {
    const seen = new Set<string>();
    return bridgeableTokens.filter((token) => {
      const key = (token.externalToken || "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [bridgeableTokens]);

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

  const isButtonDisabled = guestMode || isLoading || !amount || !!amountError
    || !selectedToken || !isConnected || !currentNetwork || !isCorrectNetwork
    || isBalanceLoading || !isTokenPermitted;

  // Effects
  useEffect(() => {
    if (!selectedNetwork && availableNetworks.length) {
      setSelectedNetwork(availableNetworks[0].chainName);
    }
    if (!selectedToken && bridgeableTokens.length) {
      setSelectedToken(bridgeableTokens[0]);
    } else if (
      selectedToken &&
      !bridgeableTokens.some((t) => t.id === selectedToken.id)
    ) {
      setSelectedToken(bridgeableTokens[0] || null);
    }

    const currentExternal = (selectedToken?.externalToken || "").toLowerCase();
    const prevExternal = prevExternalTokenRef.current;
    if (prevExternal !== null && prevExternal !== currentExternal) {
      setAmount("");
      setAmountError("");
      setSelectedAction(null);
    }
    prevExternalTokenRef.current = currentExternal;
  }, [
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    selectedToken,
    setSelectedNetwork,
    setSelectedToken,
  ]);

  useEffect(() => {
    if (selectedToken && currentNetwork) {
      fetchMinDepositAmount(selectedToken.externalToken, parseInt(selectedToken.externalDecimals || "18"));
    }
  }, [selectedToken, currentNetwork]);

  useEffect(() => {
    const handleNetworkSwitch = async () => {
      if (!selectedNetwork || !isConnected || !expectedChainId) {
        setNetworkError("");
        return;
      }
      if (chainId !== expectedChainId) {
        try {
          await switchChain({ chainId: expectedChainId });
          setNetworkError("");
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
      const isBridge = fundingMode === "bridge";
      const decimals = isBridge ? parseInt(selectedToken?.externalDecimals || "18") : 18;
      const max = isBridge ? maxAmount : metalsMaxAmount;
      handleAmountInputChange(value, setAmount, setAmountError, max, decimals);
      
      if (isBridge && value && minDepositInfo.amountWei > 0n) {
        const inputAmountWei = safeParseUnits(value, decimals);
        if (inputAmountWei < minDepositInfo.amountWei) {
          setAmountError(`Amount must be at least ${minDepositInfo.amount} ${selectedToken?.externalSymbol}`);
        }
      }
    },
    [fundingMode, maxAmount, metalsMaxAmount, selectedToken?.externalDecimals, selectedToken?.externalSymbol, minDepositInfo.amountWei, minDepositInfo.amount]
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

  const handleBuyMetals = async () => {
    if (isLoading || !selectedPayToken || !selectedMetal || !amount || !userAddress) {
      toast({ title: "Missing info", description: "Please select a token and enter an amount", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const payAmountWei = safeParseUnits(amount, 18).toString();
      const metalAmount = calcMetalAmount(amount, selectedMetal, selectedPayToken);
      const minMetalOut = (metalAmount * 9900n / 10000n).toString();

      await metalForgeService.buy(selectedMetal.address, selectedPayToken.address, payAmountWei, minMetalOut);
      toast({ title: "Success", description: `Purchased ${selectedMetal.symbol}` });
      setAmount("");
      fetchTokens();
      fetchUsdstBalance();
      onMetalPurchase?.();
    } catch (error: any) {
      toast({ title: "Transaction failed", description: error?.message || "Unknown error", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
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
      
      // Set initial step based on token type
      if (!isNative) {
        // ERC20 tokens need approval
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
        // Step: Approve Token
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
      const action = selectedAction?.action || 0;
      existing.push({
        externalChainId: parseInt(activeChainId),
        externalTxHash: txHash,
        type: action === 1 ? 'saving' : action === 2 ? 'forge' : 'bridge',
        finalTokenSymbol: selectedAction?.stratoTokenSymbol,
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

      if (action > 0 && selectedAction) {
        setCurrentStep("waiting_autosave");
        await requestDepositAction({
          externalChainId: activeChainId,
          externalTxHash: txHash,
          action,
          targetToken: action === 2 ? selectedAction.stratoToken : undefined,
        });
      }

      // Step: Complete
      setCurrentStep("complete");
      setAmount("");

      await Promise.all([
        isNative ? refetchNative() : refetchToken(),
        fetchUsdstBalance(),
      ]);
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

  const fundTokenLabel = (token: { externalSymbol?: string; externalName?: string } | null): string => {
    if (!token) return "Select asset";
    return token.externalSymbol || token.externalName || "Select asset";
  };
  
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
              onClick={() => { if (guestMode) redirectToLogin(); else setFundingMode("bridge"); }}
              className={`relative rounded-md border-2 p-3 text-left transition-colors ${
                fundingMode === "bridge"
                  ? "border-blue-500 bg-blue-500/5 dark:bg-blue-500/10"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              {fundingMode === "bridge" && <div className="absolute top-2 right-2"><CheckCircle2 className="w-5 h-5 text-blue-500" /></div>}
              <ArrowDownToLine className={`w-5 h-5 mb-2 ${fundingMode === "bridge" ? "text-blue-500" : "text-muted-foreground"}`} />
              <p className="text-sm font-semibold">{guestMode ? "Connect" : "Bridge In"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">From {networkNames}</p>
            </button>
            <button
              type="button"
              onClick={() => { if (guestMode) redirectToLogin(); else { setFundingMode("metals"); fetchTokens(); } }}
              className={`relative rounded-md border-2 p-3 text-left transition-colors ${
                fundingMode === "metals"
                  ? "border-blue-500 bg-blue-500/5 dark:bg-blue-500/10"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              {fundingMode === "metals" && <div className="absolute top-2 right-2"><CheckCircle2 className="w-5 h-5 text-blue-500" /></div>}
              <Gem className={`w-5 h-5 mb-2 ${fundingMode === "metals" ? "text-blue-500" : "text-muted-foreground"}`} />
              <p className="text-sm font-semibold">Buy Metals</p>
              <p className="text-xs text-muted-foreground mt-0.5">Gold, Silver & more</p>
            </button>
          </div>

          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
            fundingMode === "bridge" ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0"
          }`}>
            <p className="text-xs font-medium text-muted-foreground mb-2">Choose Network</p>
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
          </div>
        </section>

        {/* STEP 2 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">2</span>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">You Send</h3>
            </div>
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
              fundingMode === "bridge" ? "max-w-[300px] opacity-100" : "max-w-0 opacity-0"
            }`}>
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
          </div>

          <div className="relative">
            <CrossfadePanel active={fundingMode === "metals"}>
              <div className="rounded-md border-2 border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Select value={selectedPayToken?.address || ""}
                    onValueChange={(val) => setSelectedPayToken(metalsConfig?.payTokens.find(t => t.address === val) || null)}
                    disabled={fundingMode !== "metals" || !metalsConfig?.payTokens.length || guestMode || isLoading}>
                    <SelectTrigger className="h-10 min-w-[120px] w-auto shrink-0 gap-1 rounded-md border-border text-sm font-semibold text-foreground px-2">
                      <SelectValue placeholder="Token" />
                    </SelectTrigger>
                    <SelectContent>
                      {(metalsConfig?.payTokens || []).map((t) => (
                        <SelectItem key={t.address} value={t.address}>{t.symbol}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" placeholder="0.00"
                    className={`flex-1 h-10 text-right text-xl font-bold text-foreground border-0 focus-visible:ring-0 p-0 ${amountError ? "!text-red-500" : ""}`}
                    value={amount} onChange={(e) => handleAmountChange(e.target.value)}
                    disabled={fundingMode !== "metals" || guestMode || isLoading} />
                </div>
                {amountError && fundingMode === "metals" && <p className="text-xs text-red-500">{amountError}</p>}
                {metalsFeeError && fundingMode === "metals" && <p className="text-xs text-yellow-600">{metalsFeeError}</p>}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    Balance: <span className="text-foreground font-medium">{metalsPayBalance || "0.00"} {selectedPayToken?.symbol || ""}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <PercentageButtons value={amount} maxValue={metalsMaxAmount} onChange={handleAmountChange}
                      decimals={18} disabled={fundingMode !== "metals" || guestMode || isLoading}
                      className="[&_button]:!h-6 [&_button]:!px-2 [&_button]:!text-[10px] [&_button]:!min-w-0 [&_button:not(.border-blue-500)]:!text-muted-foreground" />
                  </div>
                </div>
              </div>
            </CrossfadePanel>
            <CrossfadePanel active={fundingMode === "bridge"}>
              <div className="rounded-md border-2 border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Select value={(selectedToken?.externalToken || "").toLowerCase()}
                    onValueChange={(val) => {
                      const match = bridgeableTokens.find((t) => (t.externalToken || "").toLowerCase() === val && t.isDefaultRoute)
                        || bridgeableTokens.find((t) => (t.externalToken || "").toLowerCase() === val) || null;
                      setSelectedToken(match);
                    }}
                    disabled={!uniqueExternalTokens.length || guestMode || isLoading}>
                    <SelectTrigger className="h-10 min-w-[120px] w-auto shrink-0 gap-1 rounded-md border-border text-sm font-semibold text-foreground px-2">
                      <SelectValue placeholder="Token" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueExternalTokens.filter((t) => t.externalSymbol || t.externalName).map((t) => (
                        <SelectItem key={t.externalToken} value={(t.externalToken || "").toLowerCase()}>
                          {fundTokenLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" placeholder="0.00"
                    className={`flex-1 h-10 text-right text-xl font-bold text-foreground border-0 focus-visible:ring-0 p-0 ${amountError ? "!text-red-500" : ""}`}
                    value={amount} onChange={(e) => handleAmountChange(e.target.value)}
                    disabled={guestMode || !isConnected || isLoading} />
                </div>
                {amountError && <p className="text-xs text-red-500">{amountError}</p>}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    Balance: <span className="text-foreground font-medium">{formatBalanceDisplay(maxAmount)} {selectedToken?.externalSymbol || ""}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <PercentageButtons value={amount} maxValue={maxAmount} onChange={handleAmountChange}
                      decimals={parseInt(selectedToken?.externalDecimals || "18")}
                      disabled={guestMode || !isConnected || isLoading}
                      className="[&_button]:!h-6 [&_button]:!px-2 [&_button]:!text-[10px] [&_button]:!min-w-0 [&_button:not(.border-blue-500)]:!text-muted-foreground" />
                  </div>
                </div>
              </div>
            </CrossfadePanel>
          </div>
        </section>

        {/* STEP 3 */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">3</span>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">You Receive On STRATO</h3>
          </div>

          <div className="relative">
            <CrossfadePanel active={fundingMode === "metals"}>
              <ScrollRow>
                {!metalsConfig
                  ? Array.from({ length: 2 }).map((_, i) => <CardSkeleton key={`ms-${i}`} id={`ms-${i}`} />)
                  : metalsConfig.metals.filter(m => m.isEnabled).map((metal) => {
                      const metalWei = amount && selectedPayToken ? calcMetalAmount(amount, metal, selectedPayToken) : 0n;
                      return (
                        <TokenCard key={metal.address}
                          active={selectedMetal?.address === metal.address}
                          image={metal.imageUrl} symbol={metal.symbol}
                          estimated={metalWei > 0n ? formatUnits(metalWei, 18) : "0"}
                          label={`${Number(metal.feeBps) / 100}% fee`}
                          onClick={() => setSelectedMetal(metal)}
                          disabled={guestMode || isLoading}
                          apyBadge={<ApyLine addr={metal.address} />}
                        />
                      );
                    })
                }
              </ScrollRow>
            </CrossfadePanel>
            <CrossfadePanel active={fundingMode === "bridge"}>
              <ScrollRow>
                {sourceTokenRoutes.length > 0 ? [
                  ...sourceTokenRoutes.map((rt) => (
                    <TokenCard key={rt.id}
                      active={rt.id === selectedToken?.id && !selectedAction}
                      image={rt.stratoTokenImage} symbol={rt.stratoTokenSymbol}
                      estimated={amount || "0"}
                      label={rt.isDefaultRoute ? "WRAP" : "MINT"}
                      onClick={() => { setSelectedToken(rt); setSelectedAction(null); }}
                      disabled={guestMode || isLoading}
                      apyBadge={<ApyLine addr={rt.stratoToken} />}
                    />
                  )),
                  ...matchingActions.map((action) => {
                    let est = amount || "0";
                    if (action.action === 2 && action.oraclePrice && amount) {
                      try {
                        const price = BigInt(action.oraclePrice);
                        if (price > 0n) est = formatUnits((safeParseUnits(amount, 18) * WAD) / price, 18);
                      } catch { /* keep */ }
                    }
                    return (
                      <TokenCard key={action.id}
                        active={selectedAction?.id === action.id}
                        image={action.stratoTokenImage} symbol={action.stratoTokenSymbol}
                        estimated={est}
                        label={action.action === 1 ? "EARN YIELD" : "BUY METAL"}
                        onClick={() => {
                          const mintRoute = sourceTokenRoutes.find(r => !r.isDefaultRoute);
                          if (mintRoute) setSelectedToken(mintRoute);
                          setSelectedAction(action);
                        }}
                        disabled={guestMode || isLoading}
                        apyBadge={<ApyLine addr={action.stratoToken} />}
                      />
                    );
                  }),
                ] : (
                  Array.from({ length: prevRouteCountRef.current }).map((_, i) => <CardSkeleton key={`bs-${i}`} id={`bs-${i}`} />)
                )}
              </ScrollRow>
            </CrossfadePanel>
          </div>
        </section>

        <div className="space-y-2">
          <Button
            onClick={fundingMode === "metals" ? handleBuyMetals : handleBridge}
            disabled={fundingMode === "metals" ? (isLoading || !selectedPayToken || !selectedMetal || !amount || guestMode) : isButtonDisabled}
            className="w-full h-11 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 text-base font-semibold"
          >
            {isLoading ? "Processing..." : fundingMode === "metals" ? `Buy ${selectedMetal?.symbol || "Metal"}` : "Deposit"}
          </Button>
          <div className={`overflow-hidden transition-all duration-300 ease-in-out text-right ${
            fundingMode === "bridge" ? "max-h-[30px] opacity-100" : "max-h-0 opacity-0"
          }`}>
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
          isEasySavings={(selectedAction?.action || 0) > 0}
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
