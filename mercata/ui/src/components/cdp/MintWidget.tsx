import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * CDP Mint flow widget (dummy UI only)
 * Mirrors basic UX from Spark.fi Easy Borrow screen.
 * Currently uses hard-coded placeholder numbers – hook up to backend later.
 */
const MintWidget: React.FC = () => {
  const [depositAsset, setDepositAsset] = useState("wstETH");
  const [depositAmount, setDepositAmount] = useState("0");
  const [borrowAsset, setBorrowAsset] = useState("USDST");
  const [borrowAmount, setBorrowAmount] = useState("0");
  const borrowRate = 5.54; // dummy %
  const maxLtv = 80; // %
  const currentLtv = 0; // % – will update when amounts come in

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Deposit / Borrow Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deposit */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Deposit</h3>
            {/* <Button variant="ghost" size="sm">Add more +</Button> */}
          </div>

          <div className="flex items-center gap-3">
            <Select value={depositAsset} onValueChange={setDepositAsset}>
              <SelectTrigger className="w-24">
                <SelectValue placeholder="Asset" />
              </SelectTrigger>
              <SelectContent>
                {[
                  { symbol: "wstETH" },
                  { symbol: "ETH" },
                  { symbol: "WBTC" },
                ].map((a) => (
                  <SelectItem key={a.symbol} value={a.symbol}>{a.symbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              className="flex-1 text-right"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="0.0"
            />
            <Button variant="ghost" size="sm">MAX</Button>
          </div>
          <p className="text-xs text-gray-500">$0.00</p>
        </div>

        {/* Borrow */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-4">
          <h3 className="font-semibold">Mint</h3>
          <div className="flex items-center gap-3">
            <Select value={borrowAsset} onValueChange={setBorrowAsset}>
              <SelectTrigger className="w-24">
                <SelectValue placeholder="Asset" />
              </SelectTrigger>
              <SelectContent>
                {[{ symbol: "USDST" }, { symbol: "USDC" }].map((a) => (
                  <SelectItem key={a.symbol} value={a.symbol}>{a.symbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="flex-1 text-right"
              value={borrowAmount}
              onChange={(e) => setBorrowAmount(e.target.value)}
              placeholder="0.0"
            />
          </div>
          <p className="text-xs text-gray-500">$0.00</p>
        </div>
      </div>

      {/* LTV & Borrow Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
        <div className="lg:col-span-2 border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center text-sm font-medium">
            <span>Collateralization Ratio (CR)</span>
            <span>{currentLtv.toFixed(2)}%</span>
          </div>
          <Slider defaultValue={[0]} max={maxLtv} step={1} disabled />
          <div className="flex justify-between text-xs text-gray-500">
            <span>0%</span>
            <span className="text-red-500">max. {maxLtv}%</span>
          </div>
        </div>

        <div className="border border-gray-200 rounded-xl p-6 bg-gray-50 text-center">
          <p className="text-sm text-gray-600 mb-2">Stability Fee</p>
          <p className="text-3xl font-semibold">{borrowRate}%</p>
        </div>
      </div>

      <Button className="w-full">Borrow</Button>
    </div>
  );
};

export default MintWidget;
