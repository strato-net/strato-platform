import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestWalletConnection } from "@/lib/auth";

interface EarnWalletConnectBannerProps {
  message?: string;
}

const EarnWalletConnectBanner = ({
  message = "Connect your wallet to view your balances and manage earn positions.",
}: EarnWalletConnectBannerProps) => (
  <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/30">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div>
          <p className="font-medium text-foreground">Wallet connection required</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button onClick={() => requestWalletConnection()} className="shrink-0">
        Connect Wallet
      </Button>
    </div>
  </div>
);

export default EarnWalletConnectBanner;
