import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { GovernedCallResult } from "@strato/shared-types";
import { useIssueExecutionHash, usePauseConverter, useUnpauseConverter } from "@/hooks/useRewardsConverter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import GovernedCallNote from "./GovernedCallNote";

interface Flip {
  result: GovernedCallResult;
  /** The position the flip asked for. */
  paused: boolean;
  /** The chain state has reached that position. */
  settled: boolean;
}

const PauseToggle = ({ paused }: { paused: boolean }) => {
  const pause = usePauseConverter();
  const unpause = useUnpauseConverter();
  // The last flip made here
  const [flip, setFlip] = useState<Flip | null>(null);
  if (flip && !flip.settled && flip.paused === paused) setFlip({ ...flip, settled: true });

  // The vote this flip was waiting on passed. Another admin's vote executed it, so that transaction is looked up
  const votePassed = !!flip?.settled && !!flip.result.issueId;
  const { data: executionHash } = useIssueExecutionHash(flip?.result.hash ?? "", votePassed);
  const result = flip && {
    ...flip.result,
    executed: flip.result.executed || votePassed,
    ...(votePassed && executionHash && { hash: executionHash, issueId: null }),
  };

  const pending = pause.isPending || unpause.isPending;
  const unsettled = !!flip && !flip.settled;
  // Submitted but not executed: the knob waits mid-way
  const waiting = unsettled && !flip.result.executed;
  // An executed flip shows its position at once, ahead of the next state refresh
  const shownPaused = unsettled ? flip.paused : paused;

  const requestFlip = (next: boolean) => {
    setFlip(null);
    (next ? pause : unpause).mutate(undefined, {
      onSuccess: (result) => setFlip({ result, paused: next, settled: false }),
    });
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
        {/* The switch stays mounted through every state, so the knob always slides between positions */}
        <span className="relative inline-flex">
          <Switch
            id="converter-paused"
            checked={waiting ? paused : shownPaused}
            disabled={pending || unsettled}
            className={`[&>span]:duration-300 ${waiting ? "[&>span]:!translate-x-2.5" : ""}`}
            onCheckedChange={requestFlip}
          />
          {pending && (
            <Loader2
              className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin ${
                paused ? "left-1 text-primary-foreground" : "right-1 text-foreground"
              }`}
            />
          )}
        </span>
        <Label htmlFor="converter-paused">
          {waiting ? (flip.paused ? "Pausing" : "Unpausing") : shownPaused ? "Paused" : "Active"}
          {waiting && [0, 200, 400].map((delay) => (
            <span key={delay} className="animate-dot-blink" style={{ animationDelay: `${delay}ms` }}>.</span>
          ))}
        </Label>
        <GovernedCallNote result={result ?? undefined}>
          {flip?.result.issueId && !votePassed && " · waiting on vote"}
        </GovernedCallNote>
      </CardContent>
    </Card>
  );
};

export default PauseToggle;
