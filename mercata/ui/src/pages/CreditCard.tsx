import { useEffect, useState, useCallback } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";
import type { CreditCardConfig } from "@mercata/shared-types";
import type { BridgeToken } from "@mercata/shared-types";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Loader2, CreditCard } from "lucide-react";
import { safeParseUnits } from "@/utils/numberUtils";
import {
  CARD_PROVIDERS,
  getProviderById,
  getNetworksForProvider,
  getTokensForProviderNetwork,
  findProviderNetworkToken,
} from "@/lib/creditCard/providers";

const DECIMALS = 18;
const MAX_APPROVE = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // 2^256 - 1

export default function CreditCardPage() {
  const { isLoggedIn } = useUser();
  const { toast } = useToast();
  const { loadNetworksAndTokens } = useBridgeContext();

  const [config, setConfig] = useState<CreditCardConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [bridgeableTokens, setBridgeableTokens] = useState<BridgeToken[]>([]);

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

  const destinationChainId = selectedNetworkChainId;
  const networksForProvider = selectedProviderId
    ? getNetworksForProvider(selectedProviderId)
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

  const loadConfig = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const { data } = await api.get<CreditCardConfig | null>("/credit-card/config");
      setConfig(data ?? null);
      if (data) {
        setSelectedNetworkChainId(data.destinationChainId);
        setCardWalletAddress(data.cardWalletAddress);
        setExternalToken(data.externalToken);
        setThresholdAmount(formatWeiToHuman(data.thresholdAmount));
        setTopUpAmount(formatWeiToHuman(data.topUpAmount));
        setUseBorrow(data.useBorrow);
        setCheckFrequencyMinutes(data.checkFrequencyMinutes);
        setCooldownMinutes(data.cooldownMinutes);
        setEnabled(data.enabled);
        setSelectedProviderId("");
        setSelectedTokenSymbol("");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    loadNetworksAndTokens().catch(console.error);
  }, [loadNetworksAndTokens]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

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
    if (!config?.destinationChainId || !config?.externalToken || bridgeableTokens.length === 0) return;
    if (selectedNetworkChainId !== config.destinationChainId) return;
    if (selectedProviderId !== "") return;
    const token = bridgeableTokens.find((t) => t.externalToken === config.externalToken);
    if (!token) return;
    const found = findProviderNetworkToken(config.destinationChainId, token.externalSymbol);
    if (found) {
      setSelectedProviderId(found.providerId);
      setSelectedNetworkChainId(found.chainId);
      setSelectedTokenSymbol(found.tokenSymbol);
    }
  }, [config?.destinationChainId, config?.externalToken, selectedNetworkChainId, selectedProviderId, bridgeableTokens]);

  const handleSave = async () => {
    if (!isLoggedIn) return;
    if (!isComboSupported) {
      toast({
        title: "This provider/network/token combination is not yet supported for bridging.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const thresholdWei = toWei(thresholdAmount);
      const topUpWei = toWei(topUpAmount);
      if (!thresholdWei || !topUpWei) {
        toast({ title: "Invalid amounts", variant: "destructive" });
        return;
      }
      await api.put("/credit-card/config", {
        destinationChainId,
        cardWalletAddress: cardWalletAddress.trim(),
        externalToken: resolvedBridgeToken!.externalToken,
        thresholdAmount: thresholdWei.toString(),
        topUpAmount: topUpWei.toString(),
        useBorrow,
        checkFrequencyMinutes,
        cooldownMinutes,
        enabled,
      });
      toast({ title: "Settings saved" });
      loadConfig();
    } catch (e: any) {
      toast({ title: e?.response?.data?.error || "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!isLoggedIn) return;
    setApproving(true);
    try {
      await api.post("/credit-card/approve", { amount: MAX_APPROVE });
      toast({ title: "Approval submitted" });
    } catch (e: any) {
      toast({ title: e?.response?.data?.error || "Approval failed", variant: "destructive" });
    } finally {
      setApproving(false);
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

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />
      <div
        className="h-screen flex flex-col transition-all duration-300"
        style={{ paddingLeft: "var(--sidebar-width, 0px)" }}
      >
        <DashboardHeader title="Crypto Credit Card" />
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to link your card wallet and set up automatic top-ups" />
          )}

          <div className="max-w-2xl space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CreditCard size={20} />
                  Card wallet &amp; settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : (
                  <>
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
                            {selectedTokenSymbol} on this network is not yet supported for bridging. We&apos;re starting with USDC on Base; more options coming soon.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label>Card wallet address</Label>
                      <Input
                        placeholder="0x..."
                        value={cardWalletAddress}
                        onChange={(e) => setCardWalletAddress(e.target.value)}
                      />
                    </div>
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
                    <div className="flex items-center justify-between">
                      <Label>Borrow USDST against collateral, then bridge</Label>
                      <Switch checked={useBorrow} onCheckedChange={setUseBorrow} />
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
                    <div className="flex items-center justify-between">
                      <Label>Auto top-up enabled</Label>
                      <Switch checked={enabled} onCheckedChange={setEnabled} />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        onClick={handleSave}
                        disabled={saving || !isComboSupported}
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save settings"}
                      </Button>
                      <Button variant="outline" onClick={handleApprove} disabled={approving}>
                        {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve USDST for top-ups"}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {config && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  {config.lastTopUpAt && <p>Last top-up: {new Date(config.lastTopUpAt).toLocaleString()}</p>}
                  {config.lastCheckedAt && <p>Last checked: {new Date(config.lastCheckedAt).toLocaleString()}</p>}
                  {config.lastError && <p className="text-destructive">Error: {config.lastError}</p>}
                </CardContent>
              </Card>
            )}
          </div>
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
