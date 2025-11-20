import React, { useState, useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useBridgeContext } from "@/context/BridgeContext";
import BridgeIn from "./BridgeIn";
import MintWidget from "../mint/MintWidget";

interface CombinedAsset {
  id: string;
  symbol: string;
  name: string;
  type: 'bridge' | 'stablecoin';
  originalAsset: any;
}

const UnifiedBridgeIn: React.FC = () => {
  const {
    availableNetworks,
    bridgeableTokens,
    redeemableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
    selectedMintToken,
    setSelectedMintToken,
    fetchRedeemableTokens,
  } = useBridgeContext();

  const [selectedAssetId, setSelectedAssetId] = useState<string>("");

  // Combine bridge assets and stablecoins into one list
  const combinedAssets = useMemo((): CombinedAsset[] => {
    const bridgeAssets: CombinedAsset[] = bridgeableTokens.map(token => ({
      id: `bridge-${token.id}`,
      symbol: token.externalSymbol,
      name: token.externalName,
      type: 'bridge' as const,
      originalAsset: token
    }));

    const stablecoinAssets: CombinedAsset[] = redeemableTokens.map(token => ({
      id: `stablecoin-${token.id}`,
      symbol: token.externalSymbol,
      name: token.externalName,
      type: 'stablecoin' as const,
      originalAsset: token
    }));

    return [...bridgeAssets, ...stablecoinAssets];
  }, [bridgeableTokens, redeemableTokens]);

  const selectedAsset = combinedAssets.find(a => a.id === selectedAssetId);

  // Load redeemable tokens when network changes
  useEffect(() => {
    if (!selectedNetwork) return;
    const networkConfig = availableNetworks.find(n => n.chainName === selectedNetwork);
    if (!networkConfig) return;
    fetchRedeemableTokens(networkConfig.chainId);
  }, [selectedNetwork, availableNetworks, fetchRedeemableTokens]);

  // Handle asset selection
  const handleAssetChange = (assetId: string) => {
    setSelectedAssetId(assetId);
    const asset = combinedAssets.find(a => a.id === assetId);

    if (asset) {
      if (asset.type === 'bridge') {
        setSelectedToken(asset.originalAsset);
        setSelectedMintToken(null);
      } else {
        setSelectedMintToken(asset.originalAsset);
        setSelectedToken(null);
      }
    }
  };

  // Reset selection when network changes
  useEffect(() => {
    setSelectedAssetId("");
    setSelectedToken(null);
    setSelectedMintToken(null);
  }, [selectedNetwork]);

  return (
    <div className="space-y-6">
      {/* Unified Network and Asset Selection */}
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label>From Network</Label>
          <Select
            value={selectedNetwork || ""}
            onValueChange={(v) => {
              setSelectedNetwork(v);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select network" />
            </SelectTrigger>
            <SelectContent>
              {availableNetworks.map((n) => (
                <SelectItem key={n.chainId} value={n.chainName}>
                  {n.chainName}
                </SelectItem>
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
          value={selectedAssetId}
          onValueChange={handleAssetChange}
          disabled={combinedAssets.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select asset" />
          </SelectTrigger>
          <SelectContent>
            {bridgeableTokens.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">
                  Bridge Assets
                </div>
                {bridgeableTokens.map((t) => (
                  <SelectItem key={`bridge-${t.id}`} value={`bridge-${t.id}`}>
                    {t.externalName} ({t.externalSymbol})
                  </SelectItem>
                ))}
              </>
            )}
            {redeemableTokens.length > 0 && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">
                  Stablecoins (Get USDST)
                </div>
                {redeemableTokens.map((t) => (
                  <SelectItem key={`stablecoin-${t.id}`} value={`stablecoin-${t.id}`}>
                    {t.externalName} ({t.externalSymbol})
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Render appropriate component based on selection */}
      {!selectedAsset && (
        <div className="text-sm text-gray-500 text-center py-8">
          Select a network and asset to continue
        </div>
      )}

      {selectedAsset?.type === 'bridge' && selectedToken && (
        <div className="unified-bridge-wrapper">
          <style>{`
            /* Keep BridgeWalletStatus (first child), hide network and asset selectors (2nd and 3rd) */
            .unified-bridge-wrapper > div > div:nth-child(2),
            .unified-bridge-wrapper > div > div:nth-child(3) {
              display: none !important;
            }
          `}</style>
          <BridgeIn />
        </div>
      )}

      {selectedAsset?.type === 'stablecoin' && selectedMintToken && (
        <div className="space-y-6">
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
            <p className="text-sm text-blue-800 font-medium">
              💱 Converting stablecoin to USDST
            </p>
          </div>
          <div className="unified-mint-wrapper">
            <style>{`
              /* Keep BridgeWalletStatus (first child), hide network and asset selectors (2nd and 3rd) */
              .unified-mint-wrapper > div > div:nth-child(2),
              .unified-mint-wrapper > div > div:nth-child(3) {
                display: none !important;
              }
            `}</style>
            <MintWidget />
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedBridgeIn;
