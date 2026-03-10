import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronDown, HelpCircle, Loader2, Info, ArrowDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/context/UserContext";
import { useOracleContext } from "@/context/OracleContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { DECIMAL_PATTERN, usdstAddress } from "@/lib/constants";
import { parseUnitsWithTruncation, formatUnits } from "@/utils/numberUtils";
import { metalForgeService, type MetalConfig, type PayTokenConfig } from "@/services/metalForgeService";

// ============================================================================
// TYPES
// ============================================================================
interface BuyMetalsWidgetProps {
  guestMode?: boolean;
}

// ============================================================================
// SMALL COMPONENTS
// ============================================================================

const TokenAvatar = ({ symbol, imageUrl, size = "w-5 h-5" }: { symbol: string; imageUrl?: string; size?: string }) => {
  if (imageUrl) {
    return <img src={imageUrl} alt={symbol} className={`${size} rounded-full object-cover`} />;
  }
  const bg = symbol.startsWith("GOLD") ? "#d4a017" : symbol.startsWith("SILV") ? "#a0a0a0" : "#2775ca";
  return (
    <div
      className={`${size} rounded-full flex items-center justify-center text-[10px] text-white font-bold`}
      style={{ backgroundColor: bg }}
    >
      {symbol.slice(0, 1)}
    </div>
  );
};

interface AssetSelectorProps<T extends { symbol: string; name: string; imageUrl?: string }> {
  selected: T | null;
  options: T[];
  onSelect: (a: T) => void;
  label: string;
  disabled?: boolean;
}

function AssetSelector<T extends { symbol: string; name: string; imageUrl?: string }>({
  selected,
  options,
  onSelect,
  label,
  disabled = false,
}: AssetSelectorProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open && !disabled} onOpenChange={o => { if (!disabled) setOpen(o); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center gap-2 justify-between text-sm px-3 py-2 h-10"
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            {selected ? <TokenAvatar symbol={selected.symbol} imageUrl={selected.imageUrl} /> : null}
            <span className="whitespace-nowrap">{selected?.symbol || label}</span>
          </div>
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0 z-50" align="end" sideOffset={5}>
        <div className="flex flex-col">
          {options.map((opt) => (
            <Button
              key={opt.symbol}
              variant="ghost"
              className="justify-start gap-2"
              onClick={() => { setOpen(false); onSelect(opt); }}
            >
              <TokenAvatar symbol={opt.symbol} imageUrl={opt.imageUrl} />
              <div className="flex flex-col items-start">
                <span className="text-sm font-medium">{opt.symbol}</span>
                <span className="text-xs text-muted-foreground">{opt.name}</span>
              </div>
              {opt.symbol === selected?.symbol && <Check className="h-4 w-4 ml-auto" />}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// BIGINT HELPERS — all display formatting from WAD-scaled BigInts
// ============================================================================
const WAD = 10n ** 18n;

function addCommas(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtWei(wei: bigint | null | undefined, displayDecimals: number = 6): string {
  const full = formatUnits(wei ?? 0n, 18);
  const [int, dec = ""] = full.split(".");
  return `${addCommas(int)}.${(dec + "0".repeat(displayDecimals)).slice(0, displayDecimals)}`;
}

function fmtDisplay(wei: bigint, displayDecimals: number = 6): string {
  const full = formatUnits(wei, 18);
  const [int, dec = ""] = full.split(".");
  const trimmed = (dec + "0".repeat(displayDecimals)).slice(0, displayDecimals).replace(/0+$/, "");
  return trimmed ? `${addCommas(int)}.${trimmed}` : addCommas(int);
}

function weiToInput(wei: bigint): string {
  const full = formatUnits(wei, 18);
  if (!full.includes(".")) return full;
  return full.replace(/\.?0+$/, "");
}

function forwardCalc(
  payAmountWei: bigint,
  feeBpsBn: bigint,
  isUsdst: boolean,
  payPriceBn: bigint,
  metalPriceBn: bigint,
): { metalAmountWei: bigint; feeWei: bigint; principalWei: bigint } {
  const feeWei = (payAmountWei * feeBpsBn) / 10000n;
  const principalWei = payAmountWei - feeWei;
  const fundsUSD = isUsdst ? principalWei : (principalWei * payPriceBn) / WAD;
  const metalAmountWei = (fundsUSD * WAD) / metalPriceBn;
  return { metalAmountWei, feeWei, principalWei };
}

function reverseCalc(
  metalAmountWei: bigint,
  feeBpsBn: bigint,
  isUsdst: boolean,
  payPriceBn: bigint,
  metalPriceBn: bigint,
): { payAmountWei: bigint; feeWei: bigint; principalWei: bigint } {
  const fundsUSD = (metalAmountWei * metalPriceBn) / WAD;
  const principalWei = isUsdst ? fundsUSD : (fundsUSD * WAD) / payPriceBn;
  const payAmountWei = feeBpsBn < 10000n
    ? (principalWei * 10000n) / (10000n - feeBpsBn)
    : 0n;
  const feeWei = payAmountWei - principalWei;
  return { payAmountWei, feeWei, principalWei };
}

// ============================================================================
// MAIN WIDGET
// ============================================================================
const BuyMetalsWidget = ({ guestMode = false }: BuyMetalsWidgetProps) => {
  const { isLoggedIn } = useUser();
  const { getPrice } = useOracleContext();
  const { activeTokens } = useUserTokens();
  const disabled = guestMode || !isLoggedIn;

  // --- MetalForge on-chain config ---
  const [metals, setMetals] = useState<MetalConfig[]>([]);
  const [payTokens, setPayTokens] = useState<PayTokenConfig[]>([]);
  const [configLoading, setConfigLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const config = await metalForgeService.getConfigs();
      setMetals(config.metals.filter(m => m.isEnabled));
      setPayTokens(config.payTokens.filter(p => p.isEnabled));
    } catch (err) {
      console.error("Failed to load MetalForge config:", err);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // --- Selection state ---
  const [selectedMetal, setSelectedMetal] = useState<MetalConfig | null>(null);
  const [selectedPayToken, setSelectedPayToken] = useState<PayTokenConfig | null>(null);
  const [payInput, setPayInput] = useState("");
  const [metalInput, setMetalInput] = useState("");
  const [activeField, setActiveField] = useState<"pay" | "metal">("pay");
  const [showConfirm, setShowConfirm] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [txSuccess, setTxSuccess] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  useEffect(() => {
    if (metals.length > 0 && !selectedMetal) setSelectedMetal(metals[0]);
  }, [metals, selectedMetal]);

  useEffect(() => {
    if (payTokens.length > 0 && !selectedPayToken) setSelectedPayToken(payTokens[0]);
  }, [payTokens, selectedPayToken]);

  // --- User balance (raw wei string from context) ---
  const balanceWei = useMemo((): bigint => {
    if (!selectedPayToken) return 0n;
    const match = activeTokens.find(t => t.address === selectedPayToken.address);
    try { return BigInt(match?.balance || "0"); } catch { return 0n; }
  }, [selectedPayToken, activeTokens]);

  // --- Mint cap remaining (BigInt) ---
  const capRemainingWei = useMemo((): bigint => {
    if (!selectedMetal) return 0n;
    const cap = BigInt(selectedMetal.mintCap || "0");
    const minted = BigInt(selectedMetal.totalMinted || "0");
    return cap > minted ? cap - minted : 0n;
  }, [selectedMetal]);

  // --- Oracle prices as BigInt (WAD-scaled) ---
  const metalPriceRaw = selectedMetal ? getPrice(selectedMetal.address) : null;
  const metalPriceBn: bigint | null = useMemo(() => {
    if (!metalPriceRaw) return null;
    try { return BigInt(metalPriceRaw); } catch { return null; }
  }, [metalPriceRaw]);

  const isPayTokenUsdst = selectedPayToken?.address === usdstAddress;
  const payPriceRaw = selectedPayToken && !isPayTokenUsdst ? getPrice(selectedPayToken.address) : null;
  const payTokenPriceBn: bigint | null = useMemo(() => {
    if (isPayTokenUsdst) return WAD;
    if (!payPriceRaw) return null;
    try { return BigInt(payPriceRaw); } catch { return null; }
  }, [isPayTokenUsdst, payPriceRaw]);

  const pricesReady = metalPriceBn !== null && metalPriceBn > 0n && payTokenPriceBn !== null;

  // --- Fee config (BigInt) ---
  const feeBpsBn = BigInt(selectedPayToken?.feeBps ?? "0");
  const feePct = Number(feeBpsBn) / 100;

  // --- Parse inputs to wei ---
  const payInputWei = useMemo((): bigint => {
    if (!payInput || payInput === ".") return 0n;
    try { return parseUnitsWithTruncation(payInput, 18); } catch { return 0n; }
  }, [payInput]);

  const metalInputWei = useMemo((): bigint => {
    if (!metalInput || metalInput === ".") return 0n;
    try { return parseUnitsWithTruncation(metalInput, 18); } catch { return 0n; }
  }, [metalInput]);

  // --- Bidirectional calculation (always forward-verified for exactness) ---
  const { computedPayWei, computedMetalWei, feeAmountWei } = useMemo(() => {
    if (!pricesReady) return { computedPayWei: 0n, computedMetalWei: 0n, feeAmountWei: 0n };

    if (activeField === "pay") {
      if (payInputWei <= 0n) return { computedPayWei: 0n, computedMetalWei: 0n, feeAmountWei: 0n };
      const { metalAmountWei, feeWei } = forwardCalc(
        payInputWei, feeBpsBn, isPayTokenUsdst, payTokenPriceBn!, metalPriceBn!,
      );
      return { computedPayWei: payInputWei, computedMetalWei: metalAmountWei, feeAmountWei: feeWei };
    }

    if (metalInputWei <= 0n) return { computedPayWei: 0n, computedMetalWei: 0n, feeAmountWei: 0n };
    const { payAmountWei, feeWei } = reverseCalc(
      metalInputWei, feeBpsBn, isPayTokenUsdst, payTokenPriceBn!, metalPriceBn!,
    );
    // Forward-verify: run the pay amount through forwardCalc to get the exact
    // metal amount the contract would produce (eliminates rounding divergence).
    const verified = forwardCalc(
      payAmountWei, feeBpsBn, isPayTokenUsdst, payTokenPriceBn!, metalPriceBn!,
    );
    return { computedPayWei: payAmountWei, computedMetalWei: verified.metalAmountWei, feeAmountWei: feeWei };
  }, [activeField, payInputWei, metalInputWei, pricesReady, feeBpsBn, isPayTokenUsdst, payTokenPriceBn, metalPriceBn]);

  // Fee in USD terms (WAD-scaled)
  const feeUsdWei = useMemo((): bigint => {
    if (!pricesReady) return 0n;
    return isPayTokenUsdst ? feeAmountWei : (feeAmountWei * payTokenPriceBn!) / WAD;
  }, [feeAmountWei, pricesReady, isPayTokenUsdst, payTokenPriceBn]);

  // Effective price per metal unit in USD: metalPrice * 10000 / (10000 - feeBps)
  const effectivePriceWei = useMemo((): bigint => {
    if (!pricesReady || feeBpsBn >= 10000n) return 0n;
    return (metalPriceBn! * 10000n) / (10000n - feeBpsBn);
  }, [pricesReady, metalPriceBn, feeBpsBn]);

  // --- Max pay input (BigInt, exact) ---
  const maxPayWei = useMemo((): bigint => {
    if (!pricesReady || metalPriceBn! <= 0n) return balanceWei;

    const maxFundsUSD = (capRemainingWei * metalPriceBn!) / WAD;
    const maxPrincipal = isPayTokenUsdst ? maxFundsUSD : (maxFundsUSD * WAD) / payTokenPriceBn!;

    let maxPayFromCap = feeBpsBn < 10000n
      ? (maxPrincipal * 10000n) / (10000n - feeBpsBn)
      : 0n;

    if (maxPayFromCap > 0n) {
      const { metalAmountWei: testMetal } = forwardCalc(
        maxPayFromCap, feeBpsBn, isPayTokenUsdst, payTokenPriceBn!, metalPriceBn!,
      );
      if (testMetal > capRemainingWei) {
        maxPayFromCap -= 1n;
      }
    }

    return balanceWei < maxPayFromCap ? balanceWei : maxPayFromCap;
  }, [balanceWei, capRemainingWei, pricesReady, metalPriceBn, payTokenPriceBn, isPayTokenUsdst, feeBpsBn]);


  // --- Validation ---
  const inputError = useMemo(() => {
    if (computedPayWei <= 0n && computedMetalWei <= 0n) return null;
    if (computedPayWei > balanceWei) return "Insufficient balance";
    if (computedMetalWei > capRemainingWei) {
      return `Exceeds available supply (${fmtWei(capRemainingWei, 2)} ${selectedMetal?.symbol})`;
    }
    return null;
  }, [computedPayWei, computedMetalWei, balanceWei, capRemainingWei, selectedMetal]);

  const handlePayChange = useCallback((val: string) => {
    if (val === "" || DECIMAL_PATTERN.test(val)) {
      setPayInput(val);
      setActiveField("pay");
    }
  }, []);

  const handleMetalChange = useCallback((val: string) => {
    if (val === "" || DECIMAL_PATTERN.test(val)) {
      setMetalInput(val);
      setActiveField("metal");
    }
  }, []);

  const handleMaxPay = useCallback(() => {
    setPayInput(weiToInput(maxPayWei));
    setActiveField("pay");
  }, [maxPayWei]);


  const SLIPPAGE_BPS = 100n;

  const minMetalOutWei = useMemo((): bigint => {
    return (computedMetalWei * (10000n - SLIPPAGE_BPS)) / 10000n;
  }, [computedMetalWei]);

  const handleConfirm = useCallback(async () => {
    if (!selectedMetal || !selectedPayToken || computedPayWei <= 0n) return;
    setTxLoading(true);
    setTxError(null);
    try {
      await metalForgeService.buy(
        selectedMetal.address,
        selectedPayToken.address,
        computedPayWei.toString(),
        minMetalOutWei.toString(),
      );
      setTxSuccess(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      const msg = e?.response?.data?.error || e?.message || "Transaction failed";
      setTxError(msg);
    } finally {
      setTxLoading(false);
    }
  }, [selectedMetal, selectedPayToken, computedPayWei, minMetalOutWei]);

  const handleReset = useCallback(() => { window.location.reload(); }, []);

  const canSubmit = computedPayWei > 0n && !inputError && !disabled && pricesReady;

  // ============================================================================
  // RENDER
  // ============================================================================

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (metals.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No metals are currently available for minting.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── You Pay ── */}
      <div className="bg-muted/50 p-4 rounded-lg border border-border">
        <div className="flex flex-col sm:flex-row sm:justify-between mb-2">
          <label className="text-sm text-muted-foreground font-semibold">You Pay</label>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <input
              type="text"
              inputMode="decimal"
              value={activeField === "pay" ? payInput : (computedPayWei > 0n ? weiToInput(computedPayWei) : "")}
              onChange={e => handlePayChange(e.target.value)}
              onFocus={() => {
                if (activeField !== "pay" && computedPayWei > 0n) setPayInput(weiToInput(computedPayWei));
              }}
              placeholder="0.00"
              disabled={disabled}
              className={`p-2 bg-transparent border-none text-lg font-medium focus:outline-none text-foreground placeholder:text-muted-foreground w-full ${
                inputError ? "border border-red-500 rounded-md" : ""
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            />
            {inputError && <p className="text-red-600 text-xs mt-1">{inputError}</p>}
          </div>
          <div className="flex-shrink-0">
            <AssetSelector<PayTokenConfig>
              selected={selectedPayToken}
              options={payTokens}
              onSelect={(t) => { setSelectedPayToken(t); setPayInput(""); }}
              label="Select token"
              disabled={disabled}
            />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <span>Balance: {fmtWei(balanceWei, 2)} {selectedPayToken?.symbol}</span>
          <button
            type="button"
            className={`text-blue-600 text-xs underline ml-1 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={handleMaxPay}
            disabled={disabled}
          >
            Max
          </button>
        </div>
      </div>

      {/* ── Arrow ── */}
      <div className="flex justify-center -my-2">
        <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center">
          <ArrowDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* ── You Receive ── */}
      <div className="bg-muted/50 p-4 rounded-lg border border-border">
        <div className="flex flex-col sm:flex-row sm:justify-between mb-2">
          <label className="text-sm text-muted-foreground font-semibold">You Receive</label>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <input
              type="text"
              inputMode="decimal"
              value={activeField === "metal" ? metalInput : (computedMetalWei > 0n ? weiToInput(computedMetalWei) : "")}
              onChange={e => handleMetalChange(e.target.value)}
              onFocus={() => {
                if (activeField !== "metal" && computedMetalWei > 0n) setMetalInput(weiToInput(computedMetalWei));
              }}
              placeholder="0.00"
              disabled={disabled}
              className={`p-2 bg-transparent border-none text-lg font-medium focus:outline-none text-foreground placeholder:text-muted-foreground w-full ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            />
          </div>
          <div className="flex-shrink-0">
            <AssetSelector<MetalConfig>
              selected={selectedMetal}
              options={metals}
              onSelect={(t) => {
                if (computedPayWei > 0n) {
                  setPayInput(weiToInput(computedPayWei));
                  setActiveField("pay");
                }
                setSelectedMetal(t);
              }}
              label="Select metal"
              disabled={disabled}
            />
          </div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
          <span>Available to mint: {fmtWei(capRemainingWei, 2)} {selectedMetal?.symbol}</span>
          <Tooltip>
            <TooltipTrigger><HelpCircle className="h-3 w-3" /></TooltipTrigger>
            <TooltipContent><p>Total remaining supply available for all users to mint in this current period.</p></TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Price Breakdown ── */}
      {computedPayWei > 0n && pricesReady && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              Spot Price
              <Tooltip>
                <TooltipTrigger><HelpCircle className="h-3.5 w-3.5" /></TooltipTrigger>
                <TooltipContent><p>Oracle price from aggregated market data</p></TooltipContent>
              </Tooltip>
            </span>
            <span>${fmtWei(metalPriceBn!, 2)} / {selectedMetal?.symbol}</span>
          </div>
          {!isPayTokenUsdst && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{selectedPayToken?.symbol} Price</span>
              <span>${fmtWei(payTokenPriceBn!, 4)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              Mint Fee ({feePct}%)
              <Tooltip>
                <TooltipTrigger><HelpCircle className="h-3.5 w-3.5" /></TooltipTrigger>
                <TooltipContent><p>Protocol fee deducted from payment amount</p></TooltipContent>
              </Tooltip>
            </span>
            <span>{fmtWei(feeAmountWei, 2)} {selectedPayToken?.symbol} (${fmtWei(feeUsdWei, 2)})</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between font-medium">
            <span>Effective Price</span>
            <span>${fmtWei(effectivePriceWei, 2)} / {selectedMetal?.symbol}</span>
          </div>
        </div>
      )}

      {/* ── Info Banner ── */}
      {!pricesReady && !configLoading && (
        <div className="flex items-start gap-2 text-xs text-amber-600 px-1">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Oracle price not available. Pricing data is loading or unavailable.</span>
        </div>
      )}

      {/* ── Submit ── */}
      <Button
        className="w-full h-11 text-sm font-medium"
        disabled={!canSubmit}
        onClick={() => setShowConfirm(true)}
      >
        {disabled
          ? "Sign in to buy metals"
          : !pricesReady
            ? "Waiting for oracle price..."
            : computedPayWei <= 0n
              ? "Enter an amount"
              : inputError
                ? inputError
                : `Buy ${selectedMetal?.symbol}`}
      </Button>

      {/* ── Confirmation Dialog ── */}
      <Dialog open={showConfirm} onOpenChange={(o) => { if (!txLoading) setShowConfirm(o); }}>
        <DialogContent className="sm:max-w-md">
          {txSuccess ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-center">Purchase Complete</DialogTitle>
                <DialogDescription className="text-center">
                  You received {fmtWei(computedMetalWei, 6)} {selectedMetal?.symbol}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center py-6 gap-3">
                <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Check className="h-7 w-7 text-green-600" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Paid {fmtDisplay(computedPayWei)} {selectedPayToken?.symbol}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Effective price: ${fmtWei(effectivePriceWei, 2)} / {selectedMetal?.symbol}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button className="w-full" onClick={handleReset}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Confirm Purchase</DialogTitle>
                <DialogDescription>Review the details of your metal purchase</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">You Pay</span>
                  <span className="font-medium">{fmtDisplay(computedPayWei)} {selectedPayToken?.symbol}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">You Receive</span>
                  <span className="font-medium">{fmtWei(computedMetalWei, 6)} {selectedMetal?.symbol}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Metal Spot Price</span>
                  <span>${fmtWei(metalPriceBn!, 2)}</span>
                </div>
                {!isPayTokenUsdst && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{selectedPayToken?.symbol} Price</span>
                    <span>${fmtWei(payTokenPriceBn!, 4)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Fee ({feePct}%)</span>
                  <span>{fmtWei(feeAmountWei, 2)} {selectedPayToken?.symbol}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Min received (1% slippage)</span>
                  <span>{fmtWei(minMetalOutWei, 6)} {selectedMetal?.symbol}</span>
                </div>
                <div className="border-t border-border pt-2 flex justify-between text-sm font-medium">
                  <span>Effective Price</span>
                  <span>${fmtWei(effectivePriceWei, 2)} / {selectedMetal?.symbol}</span>
                </div>
              </div>
              {txError && (
                <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {txError}
                </div>
              )}
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                <Button className="w-full" onClick={handleConfirm} disabled={txLoading}>
                  {txLoading ? (
                    <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Processing...</span>
                  ) : (
                    `Confirm Purchase`
                  )}
                </Button>
                <Button variant="outline" className="w-full" onClick={() => setShowConfirm(false)} disabled={txLoading}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default React.memo(BuyMetalsWidget);
