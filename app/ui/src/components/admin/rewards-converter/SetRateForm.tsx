import { useState } from "react";
import type { RewardsConverterInfo } from "@strato/shared-types";
import { useSetConverterRate } from "@/hooks/useRewardsConverter";
import { rateFromDecimal } from "@/utils/rewardsConverterMath";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import GovernedCallNote from "./GovernedCallNote";

const SetRateForm = ({ state }: { state: RewardsConverterInfo }) => {
  const setRate = useSetConverterRate();
  const [value, setValue] = useState("");
  const rate = rateFromDecimal(value);

  return (
    <Card className="border border-border/70">
      <CardHeader>
        <CardTitle className="text-lg">Set Rate</CardTitle>
        <CardDescription>
          The new rate applies to all holders as soon as the vote passes. Pause the converter first to review it before reopening.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="converter-rate">
            Rate ({state.stratoToken.symbol} per {state.rewardsToken.symbol})
          </Label>
          <Input
            id="converter-rate"
            placeholder="0.00"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button
          className="w-full"
          disabled={rate <= 0n || setRate.isPending}
          onClick={() => setRate.mutate(rate, { onSuccess: () => setValue("") })}
        >
          {setRate.isPending ? "Submitting..." : "Set Rate"}
        </Button>
        <GovernedCallNote result={setRate.data} />
      </CardContent>
    </Card>
  );
};

export default SetRateForm;
