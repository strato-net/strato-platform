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
import BridgeOut from "./BridgeOut";
import WithdrawWidget from "../mint/WithdrawWidget";
import { usdstAddress } from "@/lib/constants";

interface CombinedAsset {
  id: string;
  symbol: string;
  name: string;
  type: 'bridge' | 'usdst';
  originalAsset: any;
}

const UnifiedBridgeOut: React.FC = () => {
  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
  } = useBridgeContext();

  const [selectedAssetId, setSelectedAssetId] = useState<string>("");

  // Combine bridge assets with USDST for redemption
  const combinedAssets = useMemo((): CombinedAsset[] => {
    const bridgeAssets: CombinedAsset[] = bridgeableTokens.map(token => ({
      id: `bridge-${token.id}`,
      symbol: token.stratoTokenSymbol,
      name: token.stratoTokenName,
      type: 'bridge' as const,
      originalAsset: token
    }));

    // Add USDST as a special redemption option
    const usdstAsset: CombinedAsset = {
      id: 'usdst-redeem',
      symbol: 'USDST',
      name: 'USDST',
      type: 'usdst' as const,
      originalAsset: {
        stratoToken: usdstAddress,
        stratoTokenSymbol: 'USDST',
        stratoTokenName: 'USDST',
      }
    };

    return [...bridgeAssets, usdstAsset];
  }, [bridgeableTokens]);

  const selectedAsset = combinedAssets.find(a => a.id === selectedAssetId);

  // Set initial network selection
  useEffect(() => {
    if (!selectedNetwork && availableNetworks.length) {
      setSelectedNetwork(availableNetworks[0].chainName);
    }
  }, [availableNetworks, selectedNetwork, setSelectedNetwork]);

  // Handle asset selection
  const handleAssetChange = (assetId: string) => {
    setSelectedAssetId(assetId);
    const asset = combinedAssets.find(a => a.id === assetId);

    if (asset) {
      if (asset.type === 'bridge') {
        setSelectedToken(asset.originalAsset);
      } else {
        // For USDST, clear the selected token (WithdrawWidget handles it)
        setSelectedToken(null);
      }
    }
  };

  // Reset selection when network changes
  useEffect(() => {
    setSelectedAssetId("");
    setSelectedToken(null);
  }, [selectedNetwork, setSelectedToken]);

  return (
    <div className="space-y-6">
      {/* Unified Network and Asset Selection */}
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label>From Network</Label>
          <Input value="STRATO" disabled className="bg-gray-50" />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>To Network</Label>
          <Select
            value={selectedNetwork || ""}
            onValueChange={setSelectedNetwork}
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
                    {t.stratoTokenName} ({t.stratoTokenSymbol})
                  </SelectItem>
                ))}
              </>
            )}
            <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">
              Stablecoin Redemption
            </div>
            <SelectItem value="usdst-redeem">
              USDST (Redeem to Stablecoins)
            </SelectItem>
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
        <div className="unified-bridge-out-wrapper">
          <style>{`
            /* Keep BridgeWalletStatus (first child), hide network and asset selectors (2nd and 3rd) */
            .unified-bridge-out-wrapper > div > div:nth-child(2),
            .unified-bridge-out-wrapper > div > div:nth-child(3) {
              display: none !important;
            }
          `}</style>
          <BridgeOut />
        </div>
      )}

      {selectedAsset?.type === 'usdst' && (
        <div className="space-y-6">
          <div className="rounded-lg bg-purple-50 border border-purple-200 p-3">
            <p className="text-sm text-purple-800 font-medium">
              💵 Redeeming USDST to external stablecoins
            </p>
          </div>
          <div className="unified-withdraw-wrapper">
            <style>{`
              /* Keep BridgeWalletStatus (first child), hide network and asset selectors (2nd and 3rd) */
              .unified-withdraw-wrapper > div > div:nth-child(2),
              .unified-withdraw-wrapper > div > div:nth-child(3) {
                display: none !important;
              }
            `}</style>
            <WithdrawWidget />
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedBridgeOut;
