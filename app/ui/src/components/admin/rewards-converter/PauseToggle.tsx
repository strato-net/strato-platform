import { useState } from "react";
import { Loader2 } from "lucide-react";
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

  const pending = pause.isPending || unpause.isPending;
  // The flip was submitted but the chain state has not moved yet
  const underway = !!flip && flip.paused !== paused;

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
        {pending ? (
          <span className="flex h-6 w-11 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        ) : (
          <Switch
            id="converter-paused"
            checked={paused}
            disabled={underway}
            // Thumb held mid-way until the chain state moves
            className={underway ? "[&>span]:!translate-x-2.5" : undefined}
            onCheckedChange={requestFlip}
          />
        )}
        <Label htmlFor="converter-paused">
          {underway ? (flip.paused ? "Pausing" : "Unpausing") : paused ? "Paused" : "Active"}
          {underway && [0, 200, 400].map((delay) => (
            <span key={delay} className="animate-dot-blink" style={{ animationDelay: `${delay}ms` }}>.</span>
          ))}
        </Label>
        <GovernedCallNote result={flip?.result}>{flip?.result.issueId && " · waiting on vote"}</GovernedCallNote>
      </CardContent>
    </Card>
  );
};

export default PauseToggle;
