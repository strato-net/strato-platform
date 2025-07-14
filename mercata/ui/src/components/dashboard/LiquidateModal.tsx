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
import PercentageButtons from "@/components/ui/PercentageButtons";
import TokenIcon from "@/components/ui/TokenIcon";
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

const addCommasToInput = (value: string) => {
  if (!value) return '';
  const parts = value.split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (parts.length === 2) {
    return integerPart + '.' + parts[1];
  }
  return integerPart;
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
  const [displayAmount, setDisplayAmount] = useState<string>(addCommasToInput(maxRepayEth.toString()));

  // Reset when collateral changes or modal opens anew
  useEffect(() => {
    setRepayStr(maxRepayEth.toString());
    setDisplayAmount(addCommasToInput(maxRepayEth.toString()));
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

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setDisplayAmount(addCommasToInput(value));
      setRepayStr(value);
    }
  };

  const handlePercentageChange = (value: string) => {
    setRepayStr(value);
    setDisplayAmount(addCommasToInput(value));
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
    if (!repayWei || repayWei === "0") {
      toast({ title: "Please enter a repay amount", variant: "destructive" });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={null} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick Liquidation Calculator</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <label className="text-sm font-medium">Repay Amount ({loan.assetSymbol})</label>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Min: 0.01</span>
              <span>Max: {maxRepayEth.toFixed(2)}</span>
            </div>
            <div className="relative">
              <Input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0.00"
                className={`${repayEth > maxRepayEth ? 'text-red-600' : ''}`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
            </div>
            <PercentageButtons
              value={repayStr}
              maxValue={maxRepayEth.toString()}
              onChange={handlePercentageChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm pt-2">
            <div>
              <span className="text-gray-500">Seized Collateral</span>
              <div className="font-medium flex items-center gap-2 mt-1">
                <TokenIcon symbol={collateral.symbol || "COLL"} size="sm" />
                <span>{seizedTokensEth.toFixed(4)} {collateral.symbol || "COLL"}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Value: ${(seizedTokensEth * collPriceUsd).toFixed(2)} (includes {(bonusPct * 100).toFixed(0)}% bonus)
              </div>
            </div>
            <div>
              <span className="text-gray-500">Repay Amount (USDST)</span>
              <div className="font-medium">{repayUsdCost.toFixed(2)}</div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-md">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Estimated Profit</span>
              <span className={profitUsd >= 0 ? "text-green-600 font-semibold text-lg" : "text-red-600 font-semibold text-lg"}>
                ${profitUsd.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="px-4 py-3 bg-gray-50 rounded-md text-sm">
            <p className="text-gray-600">
              Liquidating this position will allow you to repay part of the debt in exchange for collateral at a discount. 
              The profit shown is based on current market prices.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="mr-2">
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleConfirm} 
            disabled={repayEth <= 0}
            className="px-6"
          >
            Confirm Liquidation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LiquidateModal; 