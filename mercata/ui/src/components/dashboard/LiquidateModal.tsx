import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";

interface LiquidateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loan: any; // loan entry object (from listLiquidatableLoans)
  collateral: any; // collateral entry object with maxRepay & expectedProfit
  onSuccess: () => void;
}

// ---------- helpers ----------
const weiToEth = (v?: string | number | bigint | null): number => {
  if (v === undefined || v === null) return 0;
  try {
    return Number(BigInt(v)) / 1e18;
  } catch {
    return 0;
  }
};

const ethToWei = (eth: number): string => {
  if (!isFinite(eth) || eth <= 0) return "0";
  return BigInt(Math.round(eth * 1e18)).toString();
};

const LiquidateModal: React.FC<LiquidateModalProps> = ({
  open,
  onOpenChange,
  loan,
  collateral,
  onSuccess,
}) => {
  const { toast } = useToast();

  // Guard – nothing to render if data missing
  if (!loan || !collateral) return null;

  // max repay from backend (wei) → ether
  const maxRepayEth = weiToEth(collateral.maxRepay || loan.maxRepay || "0");

  // Controlled string state so user can freely type
  const [repayStr, setRepayStr] = useState<string>(maxRepayEth.toString());

  // Reset when collateral changes or modal opens anew
  useEffect(() => {
    setRepayStr(maxRepayEth.toString());
  }, [maxRepayEth]);

  // Derived numeric value (safe)
  const repayEth = (() => {
    const num = parseFloat(repayStr);
    if (isNaN(num) || num < 0) return 0;
    if (num > maxRepayEth) return maxRepayEth;
    return num;
  })();

  // Collateral price in USD (heuristic) using usdValue / amount
  const collAmountEth = weiToEth(collateral.amount);
  const collUsdTotal = weiToEth(collateral.usdValue);
  const collPriceUsd = collAmountEth > 0 ? collUsdTotal / collAmountEth : 0;

  // Linear scaling versus backend values (maxRepay seizes all collateral)
  const bonusBp = Number(collateral.liquidationBonus || collateral.bonus || 10500);
  const bonusPct = (bonusBp - 10000) / 10000; // e.g. 0.05 for 10500

  const profitUsd = repayEth * bonusPct;

  const seizedTokensEth = collPriceUsd > 0 ? (repayEth + profitUsd) / collPriceUsd : 0;

  // Slider step – avoid 0 and avoid tiny numbers
  const sliderStep = maxRepayEth > 0 ? Math.max(maxRepayEth / 100, 0.000001) : 0.000001;

  const handleSliderChange = (val: number[]) => {
    if (!val || !val.length) return;
    setRepayStr(val[0].toString());
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRepayStr(e.target.value);
  };

  // Determine loan token USD price. For now assume 1 if symbol contains "USD", else use collPriceUsd / bonus to approximate
  let loanPriceUsd = 1;
  if (!/usd/i.test(loan.assetSymbol || "")) {
    // if not USD-like assume same price basis as collateral/borrow ratio (~ loan.amount to usdValue maybe 1)?
    loanPriceUsd = collPriceUsd > 0 ? (collPriceUsd * (profitUsd + repayEth * collPriceUsd)) / ((seizedTokensEth || 1) * collPriceUsd) : 1;
  }

  const repayUsdCost = repayEth * loanPriceUsd;

  const handleConfirm = async () => {
    const repayWei = ethToWei(repayEth);
    if (repayWei === "0") {
      toast({ title: "Repay amount must be greater than 0", variant: "destructive" });
      return;
    }
    try {
      await api.post(`/lend/liquidate/${loan.id}`, {
        collateralAsset: collateral.asset,
        repayAmount: repayWei,
      });
      toast({ title: "Liquidation submitted", variant: "success" });
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message || "Liquidation failed";
      toast({ title: "Liquidation failed", description: msg, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} key={`${loan.id}-${collateral.asset}`}> {/* unique key resets state */}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick Liquidation Calculator</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium">Repay Amount ({loan.assetSymbol})</label>
            <Input
              type="number"
              step={sliderStep}
              min={0}
              max={maxRepayEth}
              value={repayStr}
              onChange={handleInputChange}
            />
          </div>

          <Slider
            min={0}
            max={maxRepayEth}
            step={sliderStep}
            value={[repayEth]}
            onValueChange={handleSliderChange}
          />

          <div className="grid grid-cols-2 gap-4 text-sm pt-2">
            <div>
              <span className="text-muted-foreground">Seized Collateral</span>
              <div className="font-medium">
                {seizedTokensEth.toFixed(4)} {collateral.symbol || "COLL"}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Cost (USD)</span>
              <div className="font-medium">${repayUsdCost.toFixed(2)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Estimated Profit</span>
              <div className={profitUsd >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                ${profitUsd.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={repayEth <= 0}>
            Confirm Liquidation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LiquidateModal; 