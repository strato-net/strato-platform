import { useState } from "react";
import type { RewardsConverterInfo } from "@strato/shared-types";
import { useFundConverterReserve } from "@/hooks/useRewardsConverter";
import { safeParseUnits } from "@/utils/numberUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import GovernedCallNote from "./GovernedCallNote";

const FundReserveForm = ({ state }: { state: RewardsConverterInfo }) => {
  const fund = useFundConverterReserve();
  const [value, setValue] = useState("");
  const { symbol, decimals } = state.stratoToken;
  const amount = safeParseUnits(value, decimals);

  return (
    <Card className="border border-border/70">
      <CardHeader>
        <CardTitle className="text-lg">Fund Reserve</CardTitle>
        <CardDescription>
          A governed mint of {symbol} to the converter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="converter-fund-amount">Amount ({symbol})</Label>
          <Input
            id="converter-fund-amount"
            placeholder="0.00"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button
          className="w-full"
          disabled={amount <= 0n || fund.isPending}
          onClick={() => fund.mutate(amount, { onSuccess: () => setValue("") })}
        >
          {fund.isPending ? "Submitting..." : "Fund Reserve"}
        </Button>
        <GovernedCallNote result={fund.data} />
      </CardContent>
    </Card>
  );
};

export default FundReserveForm;
