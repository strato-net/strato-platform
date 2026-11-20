import { useState } from "react";
import type { RewardsConverterAdminStats, RewardsConverterInfo } from "@strato/shared-types";
import { useFundConverterReserve, useRewardsConverterAccount } from "@/hooks/useRewardsConverter";
import { safeParseUnits } from "@/utils/numberUtils";
import { formatRelevant, fundingForCoverage } from "@/utils/rewardsConverterMath";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import GovernedCallNote from "./GovernedCallNote";
import { formatTokenAmount } from "./formatTokenAmount";

const FundReserveForm = ({ state, stats }: {
  state: RewardsConverterInfo;
  stats: RewardsConverterAdminStats | undefined;
}) => {
  const fund = useFundConverterReserve();
  const { data: account } = useRewardsConverterAccount();
  const [byCoverage, setByCoverage] = useState(false);
  const [value, setValue] = useState("");
  const { symbol, decimals } = state.stratoToken;
  const supply = BigInt(stats?.outstandingSupply ?? 0);
  // A coverage is a percentage at 18 decimals. Either is read only when it is exact
  const entered = safeParseUnits(value, byCoverage ? 18 : decimals);
  const amount = byCoverage
    ? fundingForCoverage(entered, supply, BigInt(state.rate), BigInt(state.reserve))
    : entered;
  const exceedsBalance = !!account && amount > BigInt(account.stratoBalance);
  const unreadable = !!value.trim() && entered <= 0n;
  const invalid = unreadable || exceedsBalance;

  return (
    <Card className="border border-border/70">
      <CardHeader>
        <CardTitle className="text-lg">Fund Reserve</CardTitle>
        <CardDescription>
          Sends {symbol} from your account to the converter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs
          value={byCoverage ? "coverage" : "amount"}
          onValueChange={(mode) => {
            setByCoverage(mode === "coverage");
            setValue("");
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="amount">{symbol} amount</TabsTrigger>
            <TabsTrigger value="coverage">Coverage</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="space-y-2">
          <Label htmlFor="converter-fund-amount">
            {byCoverage ? "Coverage of outstanding supply (%)" : `Amount (${symbol})`}
          </Label>
          <div className="relative">
            <Input
              id="converter-fund-amount"
              className={`${byCoverage ? "pr-8" : ""} ${invalid ? "border-destructive text-destructive focus-visible:ring-destructive" : ""}`}
              aria-invalid={invalid}
              placeholder={byCoverage ? "100" : "0.00"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {byCoverage && (
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                %
              </span>
            )}
          </div>
          {byCoverage && stats && entered > 0n && (
            <p className="text-xs text-muted-foreground">
              {amount > 0n
                ? `Sends ${formatRelevant(amount, decimals)} ${symbol}`
                : "Nothing to send: the reserve already covers this."}
            </p>
          )}
          {account && (
            <p className={`text-xs ${exceedsBalance ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
              Your balance: {formatTokenAmount(account.stratoBalance, state.stratoToken)}
            </p>
          )}
        </div>
        <Button
          className="w-full"
          disabled={amount <= 0n || !account || exceedsBalance || fund.isPending}
          onClick={() => fund.mutate(amount, { onSuccess: () => setValue("") })}
        >
          {fund.isPending ? "Submitting..." : "Fund Reserve"}
        </Button>
        {/* A transfer has no vote: it has executed unless a wallet is still to sign it */}
        <GovernedCallNote
          result={fund.data && { ...fund.data, issueId: null, executed: fund.data.status !== "unsigned" }}
        />
      </CardContent>
    </Card>
  );
};

export default FundReserveForm;
