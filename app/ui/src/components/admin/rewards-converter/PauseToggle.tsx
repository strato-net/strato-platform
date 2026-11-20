import { Loader2 } from "lucide-react";
import { useGovernedChange, usePauseConverter, useUnpauseConverter } from "@/hooks/useRewardsConverter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import GovernedCallNote from "./GovernedCallNote";
import WaitingDots from "./WaitingDots";

const PauseToggle = ({ paused }: { paused: boolean }) => {
  const pause = usePauseConverter();
  const unpause = useUnpauseConverter();
  // The last flip made here. An executed one shows its position at once, ahead of the next state refresh,
  // and one that waits on its vote holds the knob mid-way
  const { result, shown: shownPaused, unsettled, waiting, track, clear } = useGovernedChange(paused);

  const pending = pause.isPending || unpause.isPending;

  const requestFlip = (next: boolean) => {
    clear();
    (next ? pause : unpause).mutate(undefined, { onSuccess: (result) => track(result, next) });
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
              className={`pointer-events-none absolute inset-y-0 my-auto h-3.5 w-3.5 animate-spin ${
                paused ? "left-1 text-primary-foreground" : "right-1 text-foreground"
              }`}
            />
          )}
        </span>
        <Label htmlFor="converter-paused">
          {waiting ? (shownPaused ? "Pausing" : "Unpausing") : shownPaused ? "Paused" : "Active"}
          {waiting && <WaitingDots />}
        </Label>
        <GovernedCallNote result={result ?? undefined}>
          {result?.issueId && !result.executed && " · waiting on vote"}
        </GovernedCallNote>
      </CardContent>
    </Card>
  );
};

export default PauseToggle;
