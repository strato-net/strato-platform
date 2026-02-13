import { useEffect, useState, useCallback } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBridgeContext } from "@/context/BridgeContext";
import { useNetwork } from "@/context/NetworkContext";
import { useUser } from "@/context/UserContext";
import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";
import type { BridgeToken } from "@mercata/shared-types";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Loader2, CreditCard, DollarSign, Plus, Settings } from "lucide-react";
import { safeParseUnits } from "@/utils/numberUtils";
import {
  CARD_PROVIDERS,
  getProviderById,
  getNetworksForProvider,
  getTokensForProviderNetwork,
  findProviderNetworkToken,
  getCardDisplayLabel,
  getNetworkName,
} from "@/lib/creditCard/providers";
import { formatWeiAmount } from "@/utils/numberUtils";

const DECIMALS = 18;
const MAX_APPROVE = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/** On-chain card shape (id = array index) */
export type OnChainCardConfig = {
  id: string;
  nickname?: string;
  providerId?: string;
  destinationChainId: string;
  externalToken: string;
  cardWalletAddress: string;
  thresholdAmount?: string;
  cooldownMinutes?: string;
  topUpAmount?: string;
  lastTopUpTimestamp?: string;
};

type CardDisplay = {
  config: OnChainCardConfig;
  providerId: string | null;
  providerName: string;
  networkName: string;
  tokenSymbol: string;
  balance: string | null;
};

const METAMASK_LOGO_URL = "https://images.ctfassets.net/clixtyxoaeas/1ezuBGezqfIeifWdVtwU4c/d970d4cdf13b163efddddd5709164d2e/MetaMask-icon-Fox.svg";
const ETHERFI_LOGO_URL = "https://avatars.githubusercontent.com/u/142260511";
/** Provider id -> logo URL for card grid and modal */
const PROVIDER_LOGO_URL: Record<string, string> = {
  "metamask-card": METAMASK_LOGO_URL,
  "etherfi-card": ETHERFI_LOGO_URL,
};

function getProviderLogoUrl(providerId: string | null): string | null {
  return (providerId && PROVIDER_LOGO_URL[providerId]) ? PROVIDER_LOGO_URL[providerId]! : null;
}

const TW = "https://raw.githubusercontent.com/trustwallet/assets/master";
const NETWORK_LOGO: Record<string, string> = {
  "8453": `${TW}/blockchains/base/info/logo.png`,
  "84532": `${TW}/blockchains/base/info/logo.png`,
  "59144": `${TW}/blockchains/linea/info/logo.png`,
  solana: `${TW}/blockchains/solana/info/logo.png`,
};
const TOKEN_LOGO: Record<string, string> = {
  USDC: `${TW}/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`,
  USDT: `${TW}/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png`,
  wETH: `${TW}/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png`,
};

function getNetworkLogoUrl(chainId: string): string | null {
  return NETWORK_LOGO[chainId] ?? null;
}
function getTokenLogoUrl(symbol: string): string | null {
  return TOKEN_LOGO[symbol?.toUpperCase()] ?? null;
}

export default function CreditCardPage() {
  const { isLoggedIn } = useUser();
  const { toast } = useToast();
  const { isTestnet } = useNetwork();
  const { loadNetworksAndTokens } = useBridgeContext();

  const [configs, setConfigs] = useState<OnChainCardConfig[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);

  const loadCards = useCallback(async () => {
    if (!isLoggedIn) return;
    setLoadingCards(true);
    try {
      const { data } = await api.get<OnChainCardConfig[]>("/credit-card");
      setConfigs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setConfigs([]);
    } finally {
      setLoadingCards(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);


  const [cardDisplays, setCardDisplays] = useState<CardDisplay[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<OnChainCardConfig | null>(null);

  const [saving, setSaving] = useState(false);
  const [bridgeableTokens, setBridgeableTokens] = useState<BridgeToken[]>([]);
  const [nickname, setNickname] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedNetworkChainId, setSelectedNetworkChainId] = useState("");
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState("");
  const [cardWalletAddress, setCardWalletAddress] = useState("");
  const [externalToken, setExternalToken] = useState("");
  const [thresholdAmount, setThresholdAmount] = useState("");
  const [topUpAmount, setTopUpAmount] = useState("");
  const [useBorrow, setUseBorrow] = useState(false);
  const [checkFrequencyMinutes, setCheckFrequencyMinutes] = useState(15);
  const [cooldownMinutes, setCooldownMinutes] = useState(60);
  const [enabled, setEnabled] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualCard, setManualCard] = useState<OnChainCardConfig | null>(null);
  const [manualAmount, setManualAmount] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  const destinationChainId = selectedNetworkChainId;
  const networksForProvider = selectedProviderId
    ? getNetworksForProvider(selectedProviderId, isTestnet)
    : [];
  const tokenSymbolsForNetwork = selectedProviderId && selectedNetworkChainId
    ? getTokensForProviderNetwork(selectedProviderId, selectedNetworkChainId)
    : [];

  const resolvedBridgeToken = selectedTokenSymbol && bridgeableTokens.length > 0
    ? bridgeableTokens.find(
        (t) => t.externalSymbol.toUpperCase() === selectedTokenSymbol.toUpperCase()
      )
    : null;
  const isComboSupported = !!resolvedBridgeToken;

  const loading = loadingCards;

  useEffect(() => {
    loadNetworksAndTokens().catch(console.error);
  }, [loadNetworksAndTokens]);

  useEffect(() => {
    if (configs.length === 0) {
      setCardDisplays([]);
      return;
    }
    const chainIds = [...new Set(configs.map((c) => c.destinationChainId))];
    const tokensByChain = new Map<string, BridgeToken[]>();
    let pending = chainIds.length;
    chainIds.forEach((chainId) => {
      api
        .get<BridgeToken[]>(`/bridge/bridgeableTokens/${chainId}`)
        .then((res) => {
          tokensByChain.set(chainId, Array.isArray(res.data) ? res.data : []);
        })
        .catch(() => tokensByChain.set(chainId, []))
        .finally(() => {
          pending -= 1;
          if (pending === 0) {
            const norm = (a: string) => (a || "").toLowerCase().replace(/^0x/, "");
            const displays: CardDisplay[] = configs.map((config) => {
              const tokens = tokensByChain.get(config.destinationChainId) ?? [];
              const configTokenNorm = norm(config.externalToken);
              const token = tokens.find((t) => norm(t.externalToken) === configTokenNorm);
              const symbol = token?.externalSymbol ?? "";
              const resolvedProviderId =
                (config.providerId && getProviderById(config.providerId))
                  ? config.providerId
                  : (findProviderNetworkToken(config.destinationChainId, symbol)?.providerId ?? null);
              const label = getCardDisplayLabel(config.destinationChainId, symbol);
              const provider = getProviderById(resolvedProviderId ?? "");
              const networkName =
                label?.networkName ?? getNetworkName(config.destinationChainId);
              return {
                config,
                providerId: resolvedProviderId,
                providerName: provider?.name ?? label?.providerName ?? "Card",
                networkName,
                tokenSymbol: symbol,
                balance: null,
              };
            });
            setCardDisplays(displays);
          }
        });
    });
  }, [configs]);

  useEffect(() => {
    if (!isLoggedIn || configs.length === 0) return;

    let cancelled = false;

    const fetchBalances = async () => {
      // Fetch each card balance independently; update UI as results arrive.
      await Promise.allSettled(
        configs.map(async (config) => {
          try {
            const res = await api.get<{ balance: string | null }>("/credit-card/balance", {
              params: {
                destinationChainId: config.destinationChainId,
                externalToken: config.externalToken,
                cardWalletAddress: config.cardWalletAddress,
              },
            });
            if (cancelled) return;
            const balance = res.data?.balance ?? null;
            setCardDisplays((prev) =>
              prev.map((cd) => (cd.config.id === config.id ? { ...cd, balance } : cd))
            );
          } catch {
            // ignore; keep previous value
          }
        })
      );
    };

    // Run immediately, then once per minute.
    void fetchBalances();
    const id = window.setInterval(fetchBalances, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [configs, isLoggedIn]);

  const openModal = (config: OnChainCardConfig | null) => {
    setEditingConfig(config);
    if (config) {
      setNickname(config.nickname ?? "");
      setSelectedProviderId(config.providerId ?? "");
      setSelectedNetworkChainId(config.destinationChainId);
      setCardWalletAddress(config.cardWalletAddress);
      setExternalToken(config.externalToken ?? "");
      setThresholdAmount(config.thresholdAmount ? formatWeiAmount(config.thresholdAmount, DECIMALS) : "");
      setTopUpAmount(config.topUpAmount ? formatWeiAmount(config.topUpAmount, DECIMALS) : "");
      setUseBorrow(false);
      setCheckFrequencyMinutes(15);
      setCooldownMinutes(config.cooldownMinutes != null ? Number(config.cooldownMinutes) : 60);
      const th = BigInt(config.thresholdAmount ?? 0);
      const tu = BigInt(config.topUpAmount ?? 0);
      setEnabled(th > 0n || tu > 0n);
      setSelectedTokenSymbol("");
    } else {
      setNickname("");
      setSelectedProviderId("");
      setSelectedNetworkChainId("");
      setSelectedTokenSymbol("");
      setCardWalletAddress("");
      setThresholdAmount("");
      setTopUpAmount("");
      setUseBorrow(false);
      setCheckFrequencyMinutes(15);
      setCooldownMinutes(60);
      setEnabled(false);
    }
    setModalOpen(true);
  };

  const openManualModal = (config: OnChainCardConfig) => {
    setManualCard(config);
    setManualAmount("");
    setManualModalOpen(true);
  };

  const closeManualModal = () => {
    setManualModalOpen(false);
    setManualCard(null);
    setManualAmount("");
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingConfig(null);
  };

  useEffect(() => {
    if (!selectedNetworkChainId) {
      setBridgeableTokens([]);
      return;
    }
    api
      .get<BridgeToken[]>(`/bridge/bridgeableTokens/${selectedNetworkChainId}`)
      .then((res) => setBridgeableTokens(Array.isArray(res.data) ? res.data : []))
      .catch(() => setBridgeableTokens([]));
  }, [selectedNetworkChainId]);

  useEffect(() => {
    if (resolvedBridgeToken) setExternalToken(resolvedBridgeToken.externalToken);
  }, [resolvedBridgeToken?.externalToken]);

  useEffect(() => {
    if (!editingConfig || !editingConfig.destinationChainId || !editingConfig.externalToken || bridgeableTokens.length === 0) return;
    if (selectedNetworkChainId !== editingConfig.destinationChainId) return;
    const norm = (a: string) => (a || "").toLowerCase().replace(/^0x/, "");
    const token = bridgeableTokens.find((t) => norm(t.externalToken) === norm(editingConfig.externalToken));
    if (!token) return;
    const found = findProviderNetworkToken(editingConfig.destinationChainId, token.externalSymbol);
    if (found) {
      setSelectedProviderId(found.providerId);
      setSelectedNetworkChainId(found.chainId);
      setSelectedTokenSymbol(found.tokenSymbol);
    }
  }, [editingConfig, selectedNetworkChainId, bridgeableTokens]);

  const handleSave = async () => {
    if (!isLoggedIn) return;
    if (!isComboSupported) {
      toast({
        title: "This provider/network/token combination is not yet supported for bridging.",
        variant: "destructive",
      });
      return;
    }
    const walletNorm = cardWalletAddress.trim().toLowerCase().replace(/^0x/, "");
    if (!editingConfig && configs.some(
      (c) =>
        c.destinationChainId === destinationChainId &&
        (c.externalToken || "").toLowerCase() === (resolvedBridgeToken!.externalToken || "").toLowerCase() &&
        (c.cardWalletAddress || "").toLowerCase().replace(/^0x/, "") === walletNorm
    )) {
      toast({ title: "This card is already connected.", variant: "destructive" });
      return;
    }
    const thresholdWei = enabled ? toWei(thresholdAmount) : 0n;
    const topUpWei = enabled ? toWei(topUpAmount) : 0n;
    if (enabled) {
      if (thresholdWei === null || thresholdWei < 0n) {
        toast({ title: "Enter a valid threshold (top up when balance below)", variant: "destructive" });
        return;
      }
      if (topUpWei === null || topUpWei < 0n) {
        toast({ title: "Enter a valid top-up amount", variant: "destructive" });
        return;
      }
    }
    const payload = {
      nickname: nickname.trim() || "",
      providerId: selectedProviderId || "",
      destinationChainId,
      externalToken: resolvedBridgeToken!.externalToken,
      cardWalletAddress: cardWalletAddress.trim(),
      thresholdAmount: (enabled ? thresholdWei! : 0n).toString(),
      cooldownMinutes: enabled ? cooldownMinutes : 0,
      topUpAmount: (enabled ? topUpWei! : 0n).toString(),
    };
    setSaving(true);
    try {
      if (editingConfig) {
        const index = parseInt(editingConfig.id, 10);
        if (Number.isNaN(index) || index < 0) throw new Error("Invalid card index");
        await api.post("/credit-card/update-card", { ...payload, index });
        toast({ title: "Card updated" });
      } else {
        await api.post("/credit-card/approve", { amount: MAX_APPROVE });
        await api.post("/credit-card/add-card", payload);
        toast({ title: "Card added" });
      }
      await loadCards();
      closeModal();
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "Failed to save";
      toast({ title: String(msg), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleManualTopUp = async () => {
    if (!isLoggedIn || !manualCard) return;
    const wei = toWei(manualAmount);
    if (wei === null || wei <= 0n) {
      toast({ title: "Enter a valid top-up amount", variant: "destructive" });
      return;
    }
    setManualSaving(true);
    try {
      await api.post("/credit-card/manual-top-up", {
        id: manualCard.id,
        amount: wei.toString(),
      });
      toast({ title: "Top-up submitted" });
      await loadCards();
      closeManualModal();
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "Failed to top up";
      toast({ title: String(msg), variant: "destructive" });
    } finally {
      setManualSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingConfig?.id) return;
    const index = parseInt(editingConfig.id, 10);
    if (Number.isNaN(index) || index < 0) return;
    setSaving(true);
    try {
      await api.post("/credit-card/remove-card", { index });
      toast({ title: "Card removed" });
      await loadCards();
      closeModal();
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message ?? "Failed to remove";
      toast({ title: String(msg), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  function toWei(human: string): bigint | null {
    try {
      return safeParseUnits(human || "0", DECIMALS);
    } catch {
      return null;
    }
  }

  function formatWeiToHuman(wei: string): string {
    try {
      const b = BigInt(wei);
      const div = 10n ** BigInt(DECIMALS);
      return (Number(b) / Number(div)).toFixed(2);
    } catch {
      return "";
    }
  }

  const cardShapeClass = "rounded-2xl border bg-gradient-to-br from-slate-800 to-slate-900 text-white p-5 min-h-[140px] flex flex-col justify-between shadow-lg aspect-[1.586/1] max-w-[320px]";

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />
      <div
        className="h-screen flex flex-col transition-all duration-300"
        style={{ paddingLeft: "var(--sidebar-width, 0px)" }}
      >
        <DashboardHeader title="Card" />
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to link your card wallet and set up automatic top-ups" />
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-12">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading...
            </div>
          ) : configs.length === 0 ? (
            <div className="flex justify-center items-center min-h-[280px]">
              <button
                type="button"
                onClick={() => openModal(null)}
                className={cardShapeClass + " w-full max-w-[320px] cursor-pointer hover:from-slate-700 hover:to-slate-800 transition-colors"}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full border-2 border-dashed border-white/50 flex items-center justify-center">
                    <Plus className="h-6 w-6" />
                  </div>
                  <span className="text-lg font-medium">Connect Card</span>
                </div>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cardDisplays.map((d) => (
                <div
                  key={d.config.id}
                  className={cardShapeClass + " text-left"}
                >
                  <div className="flex items-start justify-between">
                    <div className="relative w-20 h-20 rounded-xl bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
                      {getProviderLogoUrl(d.providerId) ? (
                        <img
                          src={getProviderLogoUrl(d.providerId)!}
                          alt={d.providerName}
                          className="h-12 w-12 object-contain"
                        />
                      ) : (
                        <CreditCard className="h-12 w-12" />
                      )}
                      {(getNetworkLogoUrl(d.config.destinationChainId) || getTokenLogoUrl(d.tokenSymbol)) && (
                        <div className="absolute bottom-0.5 right-0.5 flex gap-0.5 rounded-tl p-0.5">
                          {getNetworkLogoUrl(d.config.destinationChainId) && (
                            <img
                              src={getNetworkLogoUrl(d.config.destinationChainId)!}
                              alt=""
                              className="h-3 w-3 rounded object-contain"
                            />
                          )}
                          {getTokenLogoUrl(d.tokenSymbol) && (
                            <img
                              src={getTokenLogoUrl(d.tokenSymbol)!}
                              alt=""
                              className="h-3 w-3 rounded object-contain"
                            />
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-medium opacity-80 truncate max-w-[120px]">
                      {d.config.nickname?.trim() || d.providerName}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{d.networkName}</p>
                      <p className="text-lg font-semibold mt-1">
                        Balance: {d.balance !== null ? formatWeiAmount(d.balance, 6) : "—"} {d.tokenSymbol}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        onClick={() => openManualModal(d.config)}
                      >
                        <DollarSign className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        onClick={() => openModal(d.config)}
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => openModal(null)}
                className={cardShapeClass + " border-dashed border-2 border-slate-600 cursor-pointer hover:border-slate-500 hover:from-slate-800/80 hover:to-slate-900/80 transition-colors"}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full border-2 border-dashed border-white/50 flex items-center justify-center">
                    <Plus className="h-6 w-6" />
                  </div>
                  <span className="text-lg font-medium">Connect Card</span>
                </div>
              </button>
            </div>
          )}
        </main>
        <MobileBottomNav />
      </div>

      <Dialog open={modalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingConfig ? "Card settings" : "Connect Card"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid gap-2">
              <Label>Nickname</Label>
              <Input
                placeholder="e.g. Daily spender"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Card provider</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={selectedProviderId}
                onChange={(e) => {
                  setSelectedProviderId(e.target.value);
                  setSelectedNetworkChainId("");
                  setSelectedTokenSymbol("");
                }}
              >
                <option value="">Select card provider</option>
                {CARD_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedProviderId && (
              <div className="grid gap-2">
                <Label>Network</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={selectedNetworkChainId}
                  onChange={(e) => {
                    setSelectedNetworkChainId(e.target.value);
                    setSelectedTokenSymbol("");
                  }}
                >
                  <option value="">Select network</option>
                  {networksForProvider.map((n) => (
                    <option key={n.chainId} value={n.chainId}>
                      {n.chainName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {selectedProviderId && selectedNetworkChainId && (
              <div className="grid gap-2">
                <Label>Token</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={selectedTokenSymbol}
                  onChange={(e) => setSelectedTokenSymbol(e.target.value)}
                >
                  <option value="">Select token</option>
                  {tokenSymbolsForNetwork.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
                {selectedTokenSymbol && !isComboSupported && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {selectedTokenSymbol} on this network is not yet supported for bridging.
                  </p>
                )}
              </div>
            )}
            {isComboSupported && (
              <div className="grid gap-2">
                <Label>Card wallet address</Label>
                <Input
                  placeholder="0x..."
                  value={cardWalletAddress}
                  onChange={(e) => setCardWalletAddress(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label>Auto top-up enabled</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            {enabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Top up when balance below</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 100"
                      value={thresholdAmount}
                      onChange={(e) => setThresholdAmount(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Top-up amount</Label>
                    <Input
                      type="text"
                      placeholder="e.g. 500"
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Check frequency (minutes)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={checkFrequencyMinutes}
                      onChange={(e) => setCheckFrequencyMinutes(Number(e.target.value) || 15)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Cooldown between top-ups (minutes)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={cooldownMinutes}
                      onChange={(e) => setCooldownMinutes(Number(e.target.value) || 60)}
                    />
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <div>
                <Label>Borrow USDST against collateral, then bridge</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Coming soon</p>
              </div>
              <Switch checked={false} onCheckedChange={() => {}} disabled />
            </div>
            <div className="flex flex-wrap gap-2 pt-2 justify-end">
              <Button
                onClick={handleSave}
                disabled={saving || !isComboSupported}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingConfig ? "Save" : "Add card"}
              </Button>
              {editingConfig && (
                <Button variant="destructive" onClick={handleDelete}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove card"}
                </Button>
              )}
            </div>
            {editingConfig && (editingConfig.lastTopUpAt || editingConfig.lastError) && (
              <div className="text-sm text-muted-foreground border-t pt-2 space-y-1">
                {editingConfig.lastTopUpAt && (
                  <p>Last top-up: {new Date(editingConfig.lastTopUpAt).toLocaleString()}</p>
                )}
                {editingConfig.lastError && (
                  <p className="text-destructive">Error: {editingConfig.lastError}</p>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manualModalOpen} onOpenChange={(open) => !open && closeManualModal()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Funds to Card</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {manualCard && (
              <p className="text-sm text-muted-foreground">
                Card: <span className="font-medium">{manualCard.nickname || manualCard.id}</span>
              </p>
            )}
            <div className="grid gap-2">
              <Label>Amount</Label>
              <Input
                type="text"
                placeholder="e.g. 50"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Amount in {manualCard?.externalToken ? "token units" : "USDST equivalent"} (will be converted to wei).
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeManualModal} disabled={manualSaving}>
                Cancel
              </Button>
              <Button onClick={handleManualTopUp} disabled={manualSaving || !manualAmount.trim()}>
                {manualSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Top up"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
