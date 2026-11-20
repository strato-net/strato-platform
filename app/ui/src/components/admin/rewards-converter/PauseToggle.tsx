import { useState } from "react";
import type { GovernedCallResult } from "@strato/shared-types";
import { usePauseConverter, useUnpauseConverter } from "@/hooks/useRewardsConverter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import GovernedCallNote from "./GovernedCallNote";

const PauseToggle = ({ paused }: { paused: boolean }) => {
  const pause = usePauseConverter();
  const unpause = useUnpauseConverter();
  // The last flip made here and the position it asked for
  const [flip, setFlip] = useState<{ result: GovernedCallResult; paused: boolean } | null>(null);
  // The vote passed and the toggle moved, so the waiting note goes
  if (flip?.result.issueId && flip.paused === paused) setFlip(null);

  const requestFlip = (next: boolean) => {
    setFlip(null);
    (next ? pause : unpause).mutate(undefined, { onSuccess: (result) => setFlip({ result, paused: next }) });
  };

  return (
    <Card className="border border-border/70">
      <CardHeader>
        <CardTitle className="text-lg">Pause</CardTitle>
        <CardDescription>
          No conversion runs while the converter is paused. The toggle shows the chain state.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Switch
          id="converter-paused"
          checked={paused}
          disabled={pause.isPending || unpause.isPending}
          onCheckedChange={requestFlip}
        />
        <Label htmlFor="converter-paused">{paused ? "Paused" : "Active"}</Label>
        <GovernedCallNote result={flip?.result}>{flip?.result.issueId && " · waiting on vote"}</GovernedCallNote>
      </CardContent>
    </Card>
  );
};

export default PauseToggle;
