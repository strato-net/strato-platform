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
  useReadContracts,
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
  STRATO_NATIVE_REPRESENTATION_BRIDGE_ABI,
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
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { buildEarnApyMap } from "@/utils/earnUtils";
import { ensureHexPrefix, formatBalance, safeParseUnits, formatUnits, truncateDecimals } from "@/utils/numberUtils";
import { handleAmountInputChange, computeMaxTransferable } from "@/utils/transferValidation";
import { useBridgeContext } from "@/context/BridgeContext";
import { useEarnContext } from "@/context/EarnContext";
import { useUser } from "@/context/UserContext";
import { useNetwork } from "@/context/NetworkContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import BridgeWalletStatus from "./BridgeWalletStatus";
import ContactInquiryModal from "@/components/contact/ContactInquiryModal";
import PercentageButtons from "@/components/ui/PercentageButtons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DepositProgressModal, { DepositStep } from "./DepositProgressModal";
import MetalBuyProgressModal, { type MetalBuyStep } from "./MetalBuyProgressModal";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDownToLine, Gem, CheckCircle2, ChevronLeft, ChevronRight, AlertTriangle, Mail } from "lucide-react";
import { usdstAddress, WAD, METAL_BUY_FEE } from "@/lib/constants";
import type { WalletTxProgressEvent } from "@/lib/axios";
import { isTxPending, isTxSubmitted } from "@/utils/transactionStatus";

const METAL_BUY_FEE_WEI = safeParseUnits(METAL_BUY_FEE).toString();

/** Step 3 card APY row: fixed slot so cards match height with/without APY and vs skeleton */
const STEP3_APY_ROW_CLASS = "mt-0.5 flex min-h-[18px] items-center";

const normAddr = (a: string) => (a || "").toLowerCase().replace(/^0x/, "");

const pathForApyInfo = (info: { source: ApySource["source"]; poolAddress?: string }): string => {
  switch (info.source) {
    case "lending":
      return "/dashboard/earn-lending";
    case "vault":
      return "/dashboard/earn-vault";
    case "swap":
    case "weighted_swap":
      return info.poolAddress ? `/dashboard/earn-pools?pool=${info.poolAddress}` : "/dashboard/earn-pools";
    case "safety":
      return "/dashboard/advanced?tab=safety";
    case "staking":
      return "/dashboard/earn-staking";
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

/** WAD-scaled oracle USD price per metal unit → formatted $ */
const fmtSpotDollarWei = (weiStr: string): string | null => {
  try {
    const v = BigInt(weiStr);
    if (v <= 0n) return null;
    const s = formatUnits(v, 18);
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return null;
  }
};

/** Effective USD per metal unit after mint fee spread: spot * 10000 / (10000 - feeBps) */
const effectiveDollarWei = (spotWeiStr: string, feeBps: string): string | null => {
  try {
    const spot = BigInt(spotWeiStr);
    const bps = BigInt(feeBps || "0");
    if (spot <= 0n || bps >= 10000n) return null;
    const eff = (spot * 10000n) / (10000n - bps);
    return fmtSpotDollarWei(eff.toString());
  } catch {
    return null;
  }
};

const metalPriceRowLabels = (oracleWei: string | undefined, feeBps: string | undefined): { spot: string; effective: string } => {
  const spot = oracleWei ? fmtSpotDollarWei(oracleWei) : null;
  const eff = oracleWei && feeBps != null && feeBps !== "" ? effectiveDollarWei(oracleWei, feeBps) : null;
  return { spot: spot ?? "—", effective: eff ?? "—" };
};

const getMetalBuyStepLabel = (functionName: string | undefined, paySymbol: string, metalSymbol: string): string => {
  if (functionName === "approve") return `Approve ${paySymbol}`;
  if (functionName === "mintMetal") return `Mint ${metalSymbol}`;
  return "Confirm Metal Purchase";
};

const getMetalBuyStepDescription = (
  functionName: string | undefined,
  paySymbol: string,
  metalSymbol: string,
  amount: string
): string => {
  if (functionName === "approve") return `Approve ${amount} ${paySymbol} for MetalForge.`;
  if (functionName === "mintMetal") return `Buy ${metalSymbol} with ${amount} ${paySymbol}.`;
  return `Buy ${metalSymbol} with ${amount} ${paySymbol}.`;
};

const buildMetalBuyStep = (
  index: number,
  functionName: string | undefined,
  paySymbol: string,
  metalSymbol: string,
  amount: string
): MetalBuyStep => ({
  id: `${functionName || "metal-buy"}-${index}`,
  label: getMetalBuyStepLabel(functionName, paySymbol, metalSymbol),
  description: getMetalBuyStepDescription(functionName, paySymbol, metalSymbol, amount),
  status: "pending",
});

const buildInitialMetalBuySteps = (paySymbol: string, metalSymbol: string, amount: string): MetalBuyStep[] => [
  buildMetalBuyStep(0, "approve", paySymbol, metalSymbol, amount),
  buildMetalBuyStep(1, "mintMetal", paySymbol, metalSymbol, amount),
];

const CrossfadePanel = ({ active, children }: { active: boolean; children: React.ReactNode }) => (
  <div className={`transition-opacity duration-300 ${active ? "opacity-100" : "opacity-0 absolute inset-0 pointer-events-none"}`}>
    {children}
  </div>
);

const CardSkeleton = ({ id }: { id: string }) => (
  <div key={id} className="relative text-left rounded-md border-2 border-border p-3 animate-pulse snap-start">
    <div className="flex items-center gap-2 mb-1">
      <div className="w-6 h-6 rounded-full bg-muted shrink-0" />
      <div>
        <div className="h-[1.25rem] w-16 bg-muted rounded" />
        <div className="h-[14px] w-20 bg-muted/50 rounded mt-0.5" />
      </div>
    </div>
    <div className="h-[1rem] w-20 bg-muted rounded" />
    <div className={STEP3_APY_ROW_CLASS}>
      <div className="h-5 w-24 bg-muted/40 rounded-full" />
    </div>
    <div className="h-[14px] w-28 bg-muted/30 rounded mt-0.5" />
  </div>
);

const TokenCard = ({ active, image, symbol, estimated, onClick, disabled, apyBadge, effectivePrice, spotLabel }: {
  active: boolean; image?: string; symbol: string; estimated: string;
  onClick: () => void; disabled: boolean;
  apyBadge: React.ReactNode;
  effectivePrice?: string;
  spotLabel?: string;
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
      <div>
        <p className="text-sm font-semibold text-foreground leading-tight">{symbol}</p>
        <p className="min-h-[14px] text-[11px] text-muted-foreground leading-tight">{effectivePrice ? `${effectivePrice}/unit` : "\u00A0"}</p>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{"\u2248"} {estimated} {symbol}</p>
    {apyBadge}
    <p className="min-h-[14px] text-[10px] text-muted-foreground mt-0.5">{spotLabel || "\u00A0"}</p>
  </button>
);

/** Responsive visible-card count based on container width: 5 desktop / 4 tablet / 3 mobile / 2 narrow mobile */
const colsForWidth = (w: number) => (w >= 700 ? 5 : w >= 480 ? 4 : w >= 380 ? 3 : 2);

const ScrollRow = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [cols, setCols] = useState(3);
  const count = React.Children.count(children);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCols(colsForWidth(el.clientWidth));
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [update]);

  const scroll = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.floor(el.clientWidth / cols), behavior: "smooth" });
  };

  const visibleCols = Math.min(cols, Math.max(count, 1));
  const needsScroll = count > cols;
  const gapPx = (visibleCols - 1) * 8;
  const colWidth = `calc((100% - ${gapPx}px) / ${visibleCols})`;
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `repeat(${count || 1}, ${colWidth})`,
    ...(needsScroll ? { overflowX: "auto", scrollbarWidth: "none" } as const : {}),
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
  const { isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { openConnectModal } = useConnectModal();
  const { toast } = useToast();
  const { userAddress, externalEvmWalletAddress, isExternalEvmWalletConnected, isAppAuthenticated } = useUser();
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
  const { contactEnabled } = useNetwork();
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
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<DepositStep>("confirm_tx");
  const [progressTxHash, setProgressTxHash] = useState<string>();
  const [progressError, setProgressError] = useState<string>();
  const [progressIsNative, setProgressIsNative] = useState(true);
  const [progressIsRedemption, setProgressIsRedemption] = useState(false);
  const [metalProgressOpen, setMetalProgressOpen] = useState(false);
  const [metalSteps, setMetalSteps] = useState<MetalBuyStep[]>([]);
  const [metalProgressError, setMetalProgressError] = useState<string>();
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

  const depositableBridgeTokens = useMemo(
    () => bridgeableTokens.filter((token) => token.routeType !== "native"),
    [bridgeableTokens]
  );

  const nativeBridgeTokens = useMemo(
    () => bridgeableTokens.filter((token) => token.routeType === "native" && !token.depositsPaused),
    [bridgeableTokens]
  );

  const { sourceTokenRoutes, matchingActions } = useMemo(() => {
    if (!selectedToken) return { sourceTokenRoutes: prevCardsRef.current.routes, matchingActions: prevCardsRef.current.actions };
    const routes = selectedToken.routeType === "native"
      ? nativeBridgeTokens.filter((token) => token.id === selectedToken.id)
      : depositableBridgeTokens.filter((token) =>
          token.routeType !== "native" &&
          token.externalToken?.toLowerCase() === selectedToken.externalToken?.toLowerCase()
        );
    if (routes.length > 0) prevRouteCountRef.current = routes.length;
    const mintStratoTokens = new Set(
      routes
        .filter(r => r.routeType !== "native" && r.isDefaultRoute)
        .map(r => normAddr(r.stratoToken))
    );
    const actions = selectedToken.routeType === "native"
      ? []
      : depositActions.filter(a => a.payToken && mintStratoTokens.has(normAddr(a.payToken)));
    if (routes.length > 0) prevCardsRef.current = { routes, actions };
    return { sourceTokenRoutes: routes.length > 0 ? routes : prevCardsRef.current.routes, matchingActions: routes.length > 0 ? actions : prevCardsRef.current.actions };
  }, [depositableBridgeTokens, nativeBridgeTokens, selectedToken, depositActions]);

  const getApyInfo = useMemo(() => {
    const m = buildEarnApyMap(tokenApys);
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
          <EarnApyTooltip info={info} side="top" align="start">
            <span
              role="link"
              tabIndex={0}
              className="inline-flex items-center gap-0.5 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500 cursor-pointer hover:bg-green-500/20 transition-colors"
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
              {`Earn up to ${info.total.toFixed(2)}%`} {"\u2192"}
            </span>
          </EarnApyTooltip>
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
    return depositableBridgeTokens.filter((token) => {
      const key = (token.externalToken || "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [depositableBridgeTokens]);

  const expectedChainId = currentNetwork?.chainId ? parseInt(currentNetwork.chainId) : null;
  const externalSender = externalEvmWalletAddress;
  const externalSenderHex = externalSender ? (externalSender as `0x${string}`) : undefined;
  const stratoRecipient = userAddress;
  const hasExternalWallet = isConnected && isExternalEvmWalletConnected && !!externalSenderHex;
  const isCorrectNetwork = hasExternalWallet && !!chainId && !!expectedChainId && chainId === expectedChainId;
  const isNativeRedemption = selectedToken?.routeType === "native";
  const isNativeToken = !isNativeRedemption && BigInt(selectedToken?.externalToken || "0") === 0n;
  const fundErc20Tokens = useMemo(() => {
    const seen = new Set<string>();
    return [...uniqueExternalTokens, ...nativeBridgeTokens].filter((token) => {
      const address = (token.externalToken || "").toLowerCase();
      if (BigInt(address || "0") === 0n || seen.has(address)) return false;
      seen.add(address);
      return true;
    });
  }, [uniqueExternalTokens, nativeBridgeTokens]);
  const hasNativeFundToken = uniqueExternalTokens.some(
    (token) => BigInt(token.externalToken || "0") === 0n
  );
  const useExternalWalletSigning = hasExternalWallet && !isAppAuthenticated;
  const visibleMatchingActions = useMemo(
    () => useExternalWalletSigning ? [] : matchingActions,
    [matchingActions, useExternalWalletSigning]
  );

  const {
    data: nativeBalance,
    refetch: refetchNative,
    isLoading: nativeLoading,
  } = useBalance({
    address: externalSenderHex,
    chainId: expectedChainId || undefined,
    query: {
      enabled: hasExternalWallet && !!expectedChainId && hasNativeFundToken,
      refetchInterval: 15000,
    },
  });

  const {
    data: tokenBalanceResults,
    refetch: refetchToken,
    isLoading: tokenLoading,
  } = useReadContracts({
    contracts: fundErc20Tokens.map((token) => ({
      address: ensureHexPrefix(token.externalToken) as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: externalSenderHex ? [externalSenderHex] : undefined,
      chainId: expectedChainId || undefined,
    })),
    query: {
      enabled:
        hasExternalWallet &&
        !!expectedChainId &&
        fundErc20Tokens.length > 0,
      refetchInterval: 15000,
    },
  });

  const tokenBalancesByAddress = useMemo(() => {
    const balances = new Map<string, bigint>();
    tokenBalanceResults?.forEach((result, index) => {
      if (result.status === "success") {
        balances.set(fundErc20Tokens[index].externalToken.toLowerCase(), result.result as bigint);
      }
    });
    return balances;
  }, [fundErc20Tokens, tokenBalanceResults]);

  const tokenRawBalance = selectedToken
    ? tokenBalancesByAddress.get(selectedToken.externalToken.toLowerCase())
    : undefined;

  const getTokenOptionBalance = useCallback((token: typeof uniqueExternalTokens[number]) => {
    if (token.routeType !== "native" && BigInt(token.externalToken || "0") === 0n) {
      return nativeBalance?.value;
    }
    return tokenBalancesByAddress.get(token.externalToken.toLowerCase());
  }, [nativeBalance?.value, tokenBalancesByAddress]);

  const isTokenOptionDisabled = useCallback((token: typeof uniqueExternalTokens[number]) => {
    if (!hasExternalWallet || !expectedChainId) return false;
    const balance = getTokenOptionBalance(token);
    return balance !== undefined && balance <= 0n;
  }, [expectedChainId, getTokenOptionBalance, hasExternalWallet]);

  const sortedFundTokens = useMemo(
    () => [...uniqueExternalTokens, ...nativeBridgeTokens]
      .filter((token) => token.externalSymbol || token.externalName)
      .sort((a, b) => {
        const disabledOrder = Number(isTokenOptionDisabled(a)) - Number(isTokenOptionDisabled(b));
        if (disabledOrder !== 0) return disabledOrder;

        const aLabel = a.externalSymbol || a.externalName || "";
        const bLabel = b.externalSymbol || b.externalName || "";
        return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
      }),
    [isTokenOptionDisabled, nativeBridgeTokens, uniqueExternalTokens]
  );

  const isBalanceLoading = hasExternalWallet && !!expectedChainId
    && (isNativeToken ? nativeLoading : tokenLoading);

  const maxAmount = useMemo(() => {
    if (isNativeToken) {
      if (!nativeBalance?.value) return "0";
      return nativeBalance.value.toString();
    } else {
      if (tokenRawBalance === undefined) return "0";
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
    || !selectedToken || !hasExternalWallet || !currentNetwork || !isCorrectNetwork
    || isBalanceLoading || !isTokenPermitted;

  // Effects
  useEffect(() => {
    if (!selectedNetwork && availableNetworks.length) {
      setSelectedNetwork(availableNetworks[0].chainName);
    }
    if (!selectedToken && (depositableBridgeTokens.length || nativeBridgeTokens.length)) {
      setSelectedToken(depositableBridgeTokens[0] || nativeBridgeTokens[0]);
    } else if (
      selectedToken &&
      ![...depositableBridgeTokens, ...nativeBridgeTokens].some((t) => t.id === selectedToken.id)
    ) {
      setSelectedToken(depositableBridgeTokens[0] || nativeBridgeTokens[0] || null);
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
    depositableBridgeTokens,
    nativeBridgeTokens,
    selectedNetwork,
    selectedToken,
    setSelectedNetwork,
    setSelectedToken,
  ]);

  useEffect(() => {
    if (useExternalWalletSigning && selectedAction) {
      setSelectedAction(null);
    }
  }, [useExternalWalletSigning, selectedAction]);

  useEffect(() => {
    if (selectedToken?.routeType === "native") {
      setMinDepositInfo({ amount: "0", amountWei: 0n, loading: false });
      setIsTokenPermitted(true);
      return;
    }
    if (selectedToken && currentNetwork) {
      fetchMinDepositAmount(selectedToken.externalToken, parseInt(selectedToken.externalDecimals || "18"));
    }
  }, [selectedToken, currentNetwork]);

  useEffect(() => {
    const handleNetworkSwitch = async () => {
      if (fundingMode !== "bridge") {
        setNetworkError("");
        return;
      }
      if (!selectedNetwork || !hasExternalWallet || !expectedChainId) {
        setNetworkError("");
        return;
      }
      if (chainId !== expectedChainId) {
        if (!connector || typeof connector.getChainId !== "function") {
          setNetworkError(`Please switch to ${selectedNetwork}`);
          return;
        }
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
  }, [chainId, connector, fundingMode, hasExternalWallet, selectedNetwork, expectedChainId, switchChain]);

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
      const paySymbol = selectedPayToken.symbol || "token";
      const metalSymbol = selectedMetal.symbol || "metal";

      setMetalProgressError(undefined);
      if (useExternalWalletSigning) {
        setMetalSteps(buildInitialMetalBuySteps(paySymbol, metalSymbol, amount));
        setMetalProgressOpen(true);
      } else {
        setMetalSteps([]);
        setMetalProgressOpen(false);
      }

      const walletTxProgress = (event: WalletTxProgressEvent) => {
        setMetalSteps(prev => {
          const updated = [...prev];
          while (updated.length < event.total) {
            updated.push(buildMetalBuyStep(updated.length, undefined, paySymbol, metalSymbol, amount));
          }

          const current = updated[event.index] || buildMetalBuyStep(event.index, event.functionName, paySymbol, metalSymbol, amount);
          const status =
            event.status === "failed"
              ? "error"
              : event.status === "submitted" || event.status === "completed"
                ? "completed"
                : "processing";
          const nextStatus = current.status === "completed" && status === "processing" ? "completed" : status;

          updated[event.index] = {
            ...current,
            label: event.functionName ? getMetalBuyStepLabel(event.functionName, paySymbol, metalSymbol) : current.label,
            description: event.functionName
              ? getMetalBuyStepDescription(event.functionName, paySymbol, metalSymbol, amount)
              : current.description,
            status: nextStatus,
            hash: event.hash || current.hash,
            error: nextStatus === "error" ? event.error || current.error || "Transaction failed" : undefined,
          };

          for (let i = 0; i < event.index; i++) {
            if (updated[i] && updated[i].status !== "completed" && updated[i].status !== "error") {
              updated[i] = { ...updated[i], status: "completed" };
            }
          }

          if (nextStatus === "error") {
            for (let i = event.index + 1; i < updated.length; i++) {
              if (updated[i].status === "pending") {
                updated[i] = { ...updated[i], status: "error", error: "Skipped due to prior failure" };
              }
            }
          }

          return updated;
        });

        if (event.status === "failed" && event.error) {
          setMetalProgressError(event.error);
        }
      };

      const result = await metalForgeService.buy(
        selectedMetal.address,
        selectedPayToken.address,
        payAmountWei,
        minMetalOut,
        useExternalWalletSigning ? { walletTxProgress } : undefined
      );
      if (!isTxSubmitted(result.status)) {
        throw new Error(`Metal purchase failed: ${result.status}`);
      }

      if (useExternalWalletSigning) {
        setMetalSteps(prev => prev.map((step, index) => ({
          ...step,
          status: "completed",
          hash: step.hash || (index === 0 ? result.hash : undefined),
          error: undefined,
        })));
      }
      toast({
        title: isTxPending(result.status) ? "Submitted" : "Success",
        description: isTxPending(result.status)
          ? `Purchase submitted for ${selectedMetal.symbol}`
          : `Purchased ${selectedMetal.symbol}`,
      });
      setAmount("");
      fetchTokens();
      fetchUsdstBalance();
      onMetalPurchase?.();
    } catch (error: any) {
      const errorMessage = error?.message || "Unknown error";
      setMetalProgressError(errorMessage);
      if (useExternalWalletSigning) {
        setMetalSteps(prev => {
          const updated = [...prev];
          const activeIndex = updated.findIndex(step => step.status === "processing");
          const pendingIndex = updated.findIndex(step => step.status === "pending");
          const failedIndex = activeIndex >= 0 ? activeIndex : pendingIndex;

          if (failedIndex >= 0) {
            updated[failedIndex] = { ...updated[failedIndex], status: "error", error: errorMessage };
            for (let i = failedIndex + 1; i < updated.length; i++) {
              if (updated[i].status === "pending") {
                updated[i] = { ...updated[i], status: "error", error: "Skipped due to prior failure" };
              }
            }
          }

          return updated;
        });
      }
      toast({ title: "Transaction failed", description: errorMessage, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBridge = async () => {
    if (isLoading) return;

    if (!selectedToken || !amount || !hasExternalWallet || !isCorrectNetwork || !externalSender || !externalSenderHex || !stratoRecipient || !currentNetwork) {
      toast({
        title: "Invalid configuration",
        description: "Please check your network, wallet connection, and token selection.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setProgressError(undefined);
    
    const isNative = selectedToken.routeType !== "native" && BigInt(selectedToken.externalToken || "0") === 0n;
    setProgressIsNative(isNative);
    setProgressIsRedemption(selectedToken.routeType === "native");
    
    setProgressModalOpen(true);

    try {
      const activeChainId = currentNetwork.chainId;
      const activeChainIdNumber = Number(activeChainId);
      const depositRouter = currentNetwork.depositRouter;
      const targetStratoToken = ensureHexPrefix(selectedToken.stratoToken);
      const depositAmount = safeParseUnits(
        amount,
        parseInt(selectedToken.externalDecimals || "18"),
      );

      if (selectedToken.routeType === "native") {
        if (!selectedToken.externalBridge) {
          throw new Error("Native representation bridge is not configured for this route.");
        }

        setProgressIsNative(false);
        setCurrentStep("approve");
        const representationToken = ensureHexPrefix(selectedToken.externalToken);
        const representationBridge = ensureHexPrefix(selectedToken.externalBridge);

        const approveTx = await writeContractAsync({
          address: representationToken as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [representationBridge as `0x${string}`, depositAmount],
          chainId: activeChainIdNumber,
          account: externalSenderHex,
        });

        const approveSuccess = await waitForTransaction(approveTx, activeChainId);
        if (!approveSuccess) {
          throw new Error(`Approval reverted on ${selectedNetwork} network. Please try again.`);
        }

        setCurrentStep("confirm_tx");
        const txHash = await writeContractAsync({
          address: representationBridge as `0x${string}`,
          abi: STRATO_NATIVE_REPRESENTATION_BRIDGE_ABI,
          functionName: "requestRedemption",
          args: [
            representationToken as `0x${string}`,
            depositAmount,
            ensureHexPrefix(stratoRecipient) as `0x${string}`,
          ],
          chainId: activeChainIdNumber,
          account: externalSenderHex,
        });

        setProgressTxHash(txHash);
        setCurrentStep("waiting_tx");
        const success = await waitForTransaction(txHash, activeChainId);
        if (!success) {
          throw new Error(`Transaction reverted on ${selectedNetwork} network. No funds were redeemed to STRATO. Please try again.`);
        }

        const existing = JSON.parse(localStorage.getItem('pendingDeposits') || '[]');
        existing.push({
          externalChainId: parseInt(activeChainId),
          externalTxHash: txHash,
          type: 'bridge',
          DepositInfo: {
            externalSender,
            stratoRecipient,
            stratoToken: selectedToken.stratoToken,
            stratoTokenAmount: depositAmount.toString(),
            bridgeStatus: "1",
          },
          block_timestamp: new Date().toISOString(),
          stratoTokenSymbol: selectedToken.stratoTokenSymbol,
          externalName: selectedToken.externalName,
          externalSymbol: selectedToken.externalSymbol,
        });
        localStorage.setItem('pendingDeposits', JSON.stringify(existing));
        triggerDepositRefresh();

        setCurrentStep("complete");
        setAmount("");

        await Promise.all([
          refetchToken(),
          fetchUsdstBalance(),
        ]);
        return;
      }

      // Set initial step based on token type
      if (!isNative) {
        // ERC20 tokens need approval
        setCurrentStep("approve");
      } else {
        // Native tokens (ETH) go straight to confirm
        setCurrentStep("confirm_tx");
      }
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
          owner: externalSender,
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
            account: externalSenderHex,
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
          owner: externalSender,
        });
        
        // Move to confirm_tx step after permit is signed
        setCurrentStep("confirm_tx");
      }

      await simulateDeposit({
        depositRouter,
        isNative,
        tokenAddress: isNative ? undefined : selectedToken.externalToken,
        amount: depositAmount,
        userAddress: stratoRecipient,
        targetStratoToken,
        account: externalSender,
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
          args: [ensureHexPrefix(stratoRecipient), targetStratoToken],
          value: depositAmount,
          chain,
          account: externalSenderHex,
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
            ensureHexPrefix(stratoRecipient),
            targetStratoToken,
            permitData.nonce,
            permitData.deadline,
            permitData.signature as `0x${string}`,
          ],
          chain,
          account: externalSenderHex,
        });
      }

      setProgressTxHash(txHash);
      
      // Step: Waiting for Transaction
      setCurrentStep("waiting_tx");
      const success = await waitForTransaction(txHash, activeChainId);
      if (!success) {
        throw new Error(`Transaction reverted on ${selectedNetwork} network. No funds were deposited on STRATO. Please try again.`);
      }

      const externalDecimals = BigInt(selectedToken.externalDecimals || "18");
      const factor = BigInt(selectedToken.rebaseFactor || WAD);
      const decimalDiff = 18n - externalDecimals;
      const amount18Decimals = depositAmount * 10n ** decimalDiff;
      const adjustedAmount = (amount18Decimals * WAD / factor).toString();

      const existing = JSON.parse(localStorage.getItem('pendingDeposits') || '[]');
      const action = useExternalWalletSigning ? 0 : selectedAction?.action || 0;
      existing.push({
        externalChainId: parseInt(activeChainId),
        externalTxHash: txHash,
        type: action === 1 ? 'saving' : action === 2 ? 'forge' : 'bridge',
        finalTokenSymbol: selectedAction?.stratoTokenSymbol,
        DepositInfo: {
          externalSender,
          stratoRecipient,
          stratoToken: selectedToken.stratoToken,
          stratoTokenAmount: adjustedAmount,
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
        }, useExternalWalletSigning ? { walletAuth: true } : undefined);
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
              onClick={() => { if (guestMode) openConnectModal?.(); else setFundingMode("bridge"); }}
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
              onClick={() => { if (guestMode) openConnectModal?.(); else { setFundingMode("metals"); fetchTokens(); } }}
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
                  <BridgeWalletStatus
                    guestMode={guestMode}
                    externalOnly
                    connectedLabel="External Wallet"
                    connectLabel="Connect External"
                    copiedDescription="External wallet address copied to clipboard"
                  />
                </div>
                {hasExternalWallet && externalSender && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground font-mono hover:text-foreground transition-colors"
                    onClick={() => {
                      navigator.clipboard.writeText(externalSender);
                      toast({ title: "Copied", description: "Address copied to clipboard", duration: 1500 });
                    }}
                  >
                    {externalSender.slice(0, 6)}...{externalSender.slice(-4)}
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
                  <Select value={
                    selectedToken?.routeType === "native"
                      ? `native:${selectedToken.id}`
                      : (selectedToken?.externalToken || "").toLowerCase()
                  }
                    onValueChange={(val) => {
                      const match = val.startsWith("native:")
                        ? nativeBridgeTokens.find((t) => `native:${t.id}` === val) || null
                        : depositableBridgeTokens.find((t) => (t.externalToken || "").toLowerCase() === val && t.isDefaultRoute)
                          || depositableBridgeTokens.find((t) => (t.externalToken || "").toLowerCase() === val) || null;
                      setSelectedToken(match);
                    }}
                    disabled={(!uniqueExternalTokens.length && !nativeBridgeTokens.length) || guestMode || isLoading}>
                    <SelectTrigger className="h-10 min-w-[120px] w-auto shrink-0 gap-1 rounded-md border-border text-sm font-semibold text-foreground px-2">
                      <SelectValue placeholder="Token" />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedFundTokens.map((t) => (
                        <SelectItem
                          key={t.routeType === "native" ? t.id : t.externalToken}
                          value={t.routeType === "native"
                            ? `native:${t.id}`
                            : (t.externalToken || "").toLowerCase()}
                          disabled={isTokenOptionDisabled(t)}
                        >
                          {fundTokenLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="text" inputMode="decimal" pattern="[0-9]*\.?[0-9]*" placeholder="0.00"
                    className={`flex-1 h-10 text-right text-xl font-bold text-foreground border-0 focus-visible:ring-0 p-0 ${amountError ? "!text-red-500" : ""}`}
                    value={amount} onChange={(e) => handleAmountChange(e.target.value)}
                    disabled={guestMode || !hasExternalWallet || isLoading} />
                </div>
                {amountError && <p className="text-xs text-red-500">{amountError}</p>}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    Balance: <span className="text-foreground font-medium">{formatBalanceDisplay(maxAmount)} {selectedToken?.externalSymbol || ""}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <PercentageButtons value={amount} maxValue={maxAmount} onChange={handleAmountChange}
                      decimals={parseInt(selectedToken?.externalDecimals || "18")}
                      disabled={guestMode || !hasExternalWallet || isLoading}
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
                      const prices = metalPriceRowLabels(metal.price, metal.feeBps);
                      return (
                        <TokenCard key={metal.address}
                          active={selectedMetal?.address === metal.address}
                          image={metal.imageUrl} symbol={metal.symbol}
                          estimated={metalWei > 0n ? truncateDecimals(formatUnits(metalWei, 18), 6) : "0"}
                          onClick={() => setSelectedMetal(metal)}
                          disabled={guestMode || isLoading}
                          effectivePrice={prices.effective}
                          spotLabel={`Spot ${prices.spot} \u00B7 ${Number(metal.feeBps) / 100}% fee`}
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
                  ...sourceTokenRoutes.map((rt) => {
                    let est = amount || "0";
                    if (rt.rebaseFactor && amount) {
                      try {
                        const factor = BigInt(rt.rebaseFactor);
                        if (factor > 0n) est = truncateDecimals(formatUnits((safeParseUnits(amount, 18) * WAD) / factor, 18), 6);
                      } catch { /* keep original */ }
                    }
                    return (
                      <TokenCard key={rt.id}
                        active={rt.id === selectedToken?.id && !selectedAction}
                        image={rt.stratoTokenImage} symbol={rt.stratoTokenSymbol}
                        estimated={est}
                        onClick={() => { setSelectedToken(rt); setSelectedAction(null); }}
                        disabled={guestMode || isLoading}
                        apyBadge={<ApyLine addr={rt.stratoToken} />}
                      />
                    );
                  }),
                  ...visibleMatchingActions.map((action) => {
                    let est = amount || "0";
                    if (action.action === 2 && action.oraclePrice && amount) {
                      try {
                        const price = BigInt(action.oraclePrice);
                        if (price > 0n) est = truncateDecimals(formatUnits((safeParseUnits(amount, 18) * WAD) / price, 18), 6);
                      } catch { /* keep */ }
                    }
                    const isForge = action.action === 2;
                    const forgePrices = isForge
                      ? metalPriceRowLabels(action.oraclePrice, action.feeBps)
                      : undefined;
                    const earnPrice = !isForge && action.oraclePrice
                      ? fmtSpotDollarWei(action.oraclePrice)
                      : undefined;
                    const forgeSpotLabel = forgePrices && action.feeBps
                      ? `Spot ${forgePrices.spot} \u00B7 ${Number(action.feeBps) / 100}% fee`
                      : undefined;
                    return (
                      <TokenCard key={action.id}
                        active={selectedAction?.id === action.id}
                        image={action.stratoTokenImage} symbol={action.stratoTokenSymbol}
                        estimated={est}
                        onClick={() => {
                          const mintRoute = sourceTokenRoutes.find(r => !r.isDefaultRoute);
                          if (mintRoute) setSelectedToken(mintRoute);
                          setSelectedAction(action);
                        }}
                        disabled={guestMode || isLoading}
                        effectivePrice={forgePrices?.effective ?? earnPrice}
                        spotLabel={forgeSpotLabel}
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

        {fundingMode === "bridge" && selectedToken?.rebaseFactor && (
          <div className="flex items-start gap-3 p-3 bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/30 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <div className="font-medium mb-1">Rebasing Token</div>
              <div>
              This token&apos;s quantity may change due to rebasing events on Ethereum.<br/>
              The received amount on STRATO reflects your underlying share value at the current multiplier.
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Button
            onClick={fundingMode === "metals" ? handleBuyMetals : handleBridge}
            disabled={fundingMode === "metals" ? (isLoading || !selectedPayToken || !selectedMetal || !amount || guestMode) : isButtonDisabled}
            className="w-full h-11 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 text-base font-semibold"
          >
            {isLoading
              ? "Processing..."
              : fundingMode === "metals"
                ? `Buy ${selectedMetal?.symbol || "Metal"}`
                : selectedToken?.routeType === "native"
                  ? "Redeem to STRATO"
                  : "Deposit"}
          </Button>
          <div className={`overflow-hidden transition-all duration-300 ease-in-out text-right ${
            fundingMode === "bridge" ? "max-h-[30px] opacity-100" : "max-h-0 opacity-0"
          }`}>
            <Link to="/dashboard/withdrawals" className="text-xs text-blue-500 hover:text-blue-400">
              Need to withdraw? <span className="font-semibold">Withdraw {"\u2192"}</span>
            </Link>
          </div>
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              fundingMode === "metals" && contactEnabled ? "max-h-[120px] opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-500/10 p-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="bg-blue-500 rounded-full p-1 shrink-0">
                  <Gem className="w-3 h-3 text-white" />
                </div>
                <p className="text-xs text-muted-foreground">
                  We are currently accepting gold and silver physical deposits for tokenizing into GOLDST and SILVST.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setContactModalOpen(true)}
                className="inline-flex items-center gap-1 shrink-0 font-semibold text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline underline-offset-2"
              >
                <Mail className="w-3 h-3" />
                Contact us {"\u2192"}
              </button>
            </div>
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
          isRedemption={progressIsRedemption}
          error={progressError}
          onClose={() => {
            setProgressModalOpen(false);
            setCurrentStep("confirm_tx");
            setProgressTxHash(undefined);
            setProgressError(undefined);
            setProgressIsRedemption(false);
          }}
        />
        <MetalBuyProgressModal
          open={metalProgressOpen}
          steps={metalSteps}
          error={metalProgressError}
          onClose={() => {
            setMetalProgressOpen(false);
            setMetalSteps([]);
            setMetalProgressError(undefined);
          }}
        />
        {contactEnabled && (
          <ContactInquiryModal open={contactModalOpen} onOpenChange={setContactModalOpen} />
        )}
      </div>
    );
};

export default BridgeIn;
