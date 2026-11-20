import { useState } from "react";
import { AlertTriangle, Gift } from "lucide-react";
import type { RewardsConverterInfo } from "@strato/shared-types";
import { useUser } from "@/context/UserContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import NetworkFee, { FeeNotices } from "@/components/NetworkFee";
import { useToast } from "@/hooks/use-toast";
import { useConvertRewards, useRewardsConverterAccount } from "@/hooks/useRewardsConverter";
import { REWARDS_CONVERT_CALLS } from "@/lib/constants";
import { formatBalance, formatUnits, safeParseUnits } from "@/utils/numberUtils";
import { maxConvertAmount, payoutFor } from "@/utils/rewardsConverterMath";
import ConfirmConversionDialog from "./ConfirmConversionDialog";
import RateValue from "./RateValue";

interface ConvertRewardsCardProps {
  state: RewardsConverterInfo;
  refetchState: () => Promise<unknown>;
}

const ConvertRewardsCard = ({ state, refetchState }: ConvertRewardsCardProps) => {
  const { isLoggedIn } = useUser();
  const { toast } = useToast();
  const { data: account } = useRewardsConverterAccount();
  const convert = useConvertRewards();

  const [amountInput, setAmountInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { rewardsToken, stratoToken, paused } = state;
  const maxConvertible = BigInt(state.maxConvertible);
  const balance = BigInt(account?.balance ?? "0");
  const maxAmount = maxConvertAmount(balance, maxConvertible);
  const amount = safeParseUnits(amountInput, rewardsToken.decimals);
  const payout = payoutFor(amount, BigInt(state.rate));
  const canConvert = !paused && amount > 0n && amount <= maxAmount && payout > 0n;
  const formDisabled = !isLoggedIn || paused || convert.isPending;

  const converted = `${formatUnits(amount, rewardsToken.decimals)} ${rewardsToken.symbol}`;
  const received = `${formatUnits(payout, stratoToken.decimals)} ${stratoToken.symbol}`;

  // The dialog confirms against fresh state: a rate change or pause since the last poll shows before signing
  const openConfirm = async () => {
    setConfirmOpen(true);
    setRefreshing(true);
    await refetchState();
    setRefreshing(false);
  };

  const handleConvert = () => {
    setConfirmOpen(false);
    convert.mutate(amount, {
      onSuccess: () => {
        toast({
          title: "Conversion Complete",
          description: `Converted ${converted} for ${received}`,
          variant: "success",
        });
        setAmountInput("");
      },
    });
  };

  return (
    <Card className="mb-6 border-0 md:border shadow-none md:shadow-sm">
      <CardHeader className="px-2 py-2 md:px-6 md:py-6">
        <CardTitle className="flex items-center gap-2">
          <Gift className="h-5 w-5" />
          Convert Rewards → STRATO
          <Badge variant={paused ? "destructive" : "default"}>
            {paused ? "Paused" : "Active"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 py-2 md:px-6 md:py-6">
        <div className="flex flex-col space-y-4 max-w-2xl mx-auto">
          {paused && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-600/40 bg-yellow-500/10 p-3 text-yellow-700 dark:text-yellow-500">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div className="text-xs">
                <p className="font-medium">Conversions are paused</p>
                <p className="opacity-80">
                  You can convert {rewardsToken.symbol} again once the converter is unpaused.
                </p>
              </div>
            </div>
          )}

          <div className="bg-card rounded-lg p-4 border border-border">
            <h3 className="font-medium mb-3">
              Convert {rewardsToken.symbol} to {stratoToken.symbol}
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Converted {rewardsToken.symbol} is burned and you receive{" "}
              {stratoToken.symbol} from the reserve at the current rate.
            </p>

            <div className="space-y-1 text-sm mb-3">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Rate</span>
                <span>
                  1 {rewardsToken.symbol} = <RateValue rate={state.rate} /> {stratoToken.symbol}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Reserve</span>
                <span>
                  {formatBalance(state.reserve, stratoToken.symbol, stratoToken.decimals, 2, 6)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Input
                type="number"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                disabled={formDisabled}
              />

              {isLoggedIn && (
                <div className="text-sm text-muted-foreground">
                  <button
                    type="button"
                    className="text-blue-600 hover:underline mr-2 disabled:opacity-50 disabled:no-underline"
                    onClick={() => setAmountInput(formatUnits(maxAmount, rewardsToken.decimals))}
                    disabled={formDisabled || maxAmount === 0n}
                  >
                    Max
                  </button>
                  Balance:{" "}
                  {account
                    ? formatBalance(account.balance, rewardsToken.symbol, rewardsToken.decimals, 2, 6)
                    : "…"}
                </div>
              )}

              {account && !paused && balance > maxConvertible && (
                <p className="text-sm text-yellow-600">
                  Only {formatBalance(maxConvertible, rewardsToken.symbol, rewardsToken.decimals, 2, 6)}{" "}
                  can be converted right now
                </p>
              )}

              <div className="text-sm text-muted-foreground">
                You receive:{" "}
                {formatBalance(payout, stratoToken.symbol, stratoToken.decimals, 2, 6)}
              </div>

              {isLoggedIn && (
                <div className="text-sm text-muted-foreground">
                  Transaction Fee: <NetworkFee calls={REWARDS_CONVERT_CALLS} />
                  <FeeNotices calls={REWARDS_CONVERT_CALLS} />
                </div>
              )}

              <Button
                onClick={openConfirm}
                className="bg-strato-blue hover:bg-strato-blue/90 w-full"
                disabled={formDisabled || !canConvert}
              >
                {convert.isPending ? "Processing..." : `Convert ${rewardsToken.symbol}`}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>

      <ConfirmConversionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        converted={converted}
        received={received}
        confirmDisabled={refreshing || !canConvert}
        onConfirm={handleConvert}
      />
    </Card>
  );
};

export default ConvertRewardsCard;
