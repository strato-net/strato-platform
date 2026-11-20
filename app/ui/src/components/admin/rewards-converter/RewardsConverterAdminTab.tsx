import { Loader2 } from "lucide-react";
import { useRewardsConverterAdminStats, useRewardsConverterState } from "@/hooks/useRewardsConverter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ConversionVolume from "./ConversionVolume";
import ConverterNumbers from "./ConverterNumbers";
import FundReserveForm from "./FundReserveForm";
import PauseToggle from "./PauseToggle";
import SetRateForm from "./SetRateForm";
import WithdrawReserveForm from "./WithdrawReserveForm";

const RewardsConverterAdminTab = () => {
  const { data: state, isLoading } = useRewardsConverterState();
  const { data: stats } = useRewardsConverterAdminStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!state?.configured) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          {state ? "The Rewards Converter is not deployed on this network." : "The converter state could not be loaded."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rewards Converter</CardTitle>
        <CardDescription>
          The converter burns {state.rewardsToken.symbol.toLowerCase()} and pays {state.stratoToken.symbol} from the reserve at the rate. Every change here is a governed call, except funding the reserve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ConverterNumbers state={state} stats={stats} />
        <div className="grid gap-4 xl:grid-cols-3">
          <PauseToggle paused={state.paused} />
          <SetRateForm state={state} />
          <FundReserveForm state={state} />
        </div>
        <WithdrawReserveForm state={state} />
        <ConversionVolume state={state} />
      </CardContent>
    </Card>
  );
};

export default RewardsConverterAdminTab;
