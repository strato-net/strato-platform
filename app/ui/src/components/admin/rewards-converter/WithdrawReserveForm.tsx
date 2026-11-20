import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { RewardsConverterInfo } from "@strato/shared-types";
import { useWithdrawConverterReserve } from "@/hooks/useRewardsConverter";
import { safeParseUnits } from "@/utils/numberUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatTokenAmount } from "./formatTokenAmount";
import GovernedCallNote from "./GovernedCallNote";

const isFullAddress = (value: string): boolean => /^(0x)?[a-fA-F0-9]{40}$/.test(value);

const WithdrawReserveForm = ({ state }: { state: RewardsConverterInfo }) => {
  const withdraw = useWithdrawConverterReserve();
  const [recipient, setRecipient] = useState("");
  const [value, setValue] = useState("");
  const { symbol, decimals } = state.stratoToken;
  const to = recipient.trim();
  const amount = safeParseUnits(value, decimals);
  const exceedsReserve = amount > BigInt(state.reserve);

  return (
    <Collapsible asChild>
      <Card className="border border-border/70">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 p-6 text-left">
          <span className="flex flex-col space-y-1.5">
            <span className="text-lg font-semibold leading-none tracking-tight">Withdraw Reserve</span>
            <span className="text-sm text-muted-foreground">
              A reserve withdrawal sends {symbol} from the reserve to another address.
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="converter-withdraw-recipient">Recipient Address</Label>
              <Input
                id="converter-withdraw-recipient"
                placeholder="0x..."
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
              {to && !isFullAddress(to) && (
                <p className="text-xs text-red-600 dark:text-red-400">Enter the full recipient address.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="converter-withdraw-amount">Amount ({symbol})</Label>
              <Input
                id="converter-withdraw-amount"
                placeholder="0.00"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              <p className={`text-xs ${exceedsReserve ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                Reserve: {formatTokenAmount(state.reserve, state.stratoToken)}
              </p>
            </div>
            <Button
              className="w-full"
              disabled={!isFullAddress(to) || amount <= 0n || exceedsReserve || withdraw.isPending}
              onClick={() => withdraw.mutate({ to, amount }, { onSuccess: () => setValue("") })}
            >
              {withdraw.isPending ? "Submitting..." : "Withdraw Reserve"}
            </Button>
            <GovernedCallNote result={withdraw.data} />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

export default WithdrawReserveForm;
