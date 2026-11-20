import { useState } from "react";
import type { RewardsConverterInfo } from "@strato/shared-types";
import { useGovernedChange, useSetConverterRate } from "@/hooks/useRewardsConverter";
import { rateFromDecimal } from "@/utils/rewardsConverterMath";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import GovernedCallNote from "./GovernedCallNote";
import WaitingDots from "./WaitingDots";

const SetRateForm = ({ state }: { state: RewardsConverterInfo }) => {
  const setRate = useSetConverterRate();
  const [value, setValue] = useState("");
  // What was typed for the last rate submitted: the input holds it while that rate waits on its vote
  const [submitted, setSubmitted] = useState("");
  const { result, waiting, track, clear } = useGovernedChange(state.rate);
  const rate = rateFromDecimal(value);
  const invalid = !!value.trim() && rate <= 0n;
  const busy = setRate.isPending || waiting;

  const submit = () => {
    clear();
    setRate.mutate(rate, {
      onSuccess: (result) => {
        track(result, rate.toString());
        setSubmitted(value);
        setValue("");
      },
    });
  };

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
            Rate ({state.stratoToken.symbol} per Rewards Point)
          </Label>
          <Input
            id="converter-rate"
            className={invalid ? "border-destructive text-destructive focus-visible:ring-destructive" : ""}
            aria-invalid={invalid}
            placeholder="0.00"
            value={waiting ? submitted : value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button className="w-full" disabled={rate <= 0n || busy} onClick={submit}>
          {waiting ? <>Setting Rate<WaitingDots /></> : setRate.isPending ? "Submitting..." : "Set Rate"}
        </Button>
        <GovernedCallNote result={result ?? undefined}>
          {result?.issueId && !result.executed && " · waiting on vote"}
        </GovernedCallNote>
      </CardContent>
    </Card>
  );
};

export default SetRateForm;
