import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import GuestSignInPrompt from "@/components/ui/GuestSignInPrompt";
import { formatNumber } from "@/utils/numberUtils";

interface GuestVaultsViewProps {
  cdpAssets: Array<{
    asset: string;
    symbol: string;
    isSupported: boolean;
    minCR: number;              // Min collateral ratio (max LTV = 100/minCR)
    liquidationRatio: number;   // Liquidation threshold
    stabilityFeeRate: number;   // Annual interest rate
  }>;
  loadingAssets: boolean;
}

/**
 * Guest view for Vaults sub-tab - shows available collateral assets
 */
const GuestVaultsView: React.FC<GuestVaultsViewProps> = ({ cdpAssets, loadingAssets }) => {
  // Filter to only show supported assets
  const supportedAssets = cdpAssets.filter(asset => asset.isSupported);

  return (
    <div className="space-y-6">
      {/* Sign In Prompt */}
      <GuestSignInPrompt
        title="CDP Vaults"
        description="Sign in to create and manage your Collateralized Debt Position (CDP) vaults. Mint USDST stablecoin against your collateral assets."
        buttonText="Sign In to Get Started"
      />

      {/* Available Collateral Assets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">Available Collateral Assets</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingAssets ? (
            <div className="text-center py-6 text-muted-foreground">
              Loading available assets...
            </div>
          ) : supportedAssets.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              No collateral assets available at this time.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-4 text-xs md:text-sm font-medium text-muted-foreground pb-2 border-b">
                <div>Asset</div>
                <div>Max LTV</div>
                <div>Liquidation Threshold</div>
                <div>Stability Fee</div>
              </div>
              {supportedAssets.map((asset) => (
                <div 
                  key={asset.asset} 
                  className="grid grid-cols-4 gap-4 py-2 text-sm items-center"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold">
                      {asset.symbol.charAt(0)}
                    </div>
                    <span className="font-medium">{asset.symbol}</span>
                  </div>
                  <div>
                    {/* Max LTV = 100 / minCR (e.g., minCR=150% means max LTV = 66.67%) */}
                    {asset.minCR > 0 ? `${formatNumber(10000 / asset.minCR, 1)}%` : '--'}
                  </div>
                  <div>
                    {asset.liquidationRatio > 0 ? `${formatNumber(asset.liquidationRatio, 0)}%` : '--'}
                  </div>
                  <div>
                    {asset.stabilityFeeRate > 0 ? `${formatNumber(asset.stabilityFeeRate, 2)}%` : '--'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GuestVaultsView;
