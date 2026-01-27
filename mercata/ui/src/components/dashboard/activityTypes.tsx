import { ReactNode } from "react";
import type { Event } from "@mercata/shared-types";
import { Card, CardTitle, CardHeader, CardContent, CardDescription } from "../ui/card";
import { formatUnits } from "viem";
import { ArrowUpRight, ArrowDownLeft, ArrowDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getChainName } from "@/lib/bridge/utils";
import CopyButton from "@/components/ui/copy";
import { Badge } from "@/components/ui/badge";

/**
 * Activity handler function type
 * Processes events and returns Card components
 * @param event - The event data
 * @param tokenSymbol - Optional token symbol for Transfer events
 * @param userAddress - Optional user address for highlighting "You"
 */
export type ActivityHandler = (event: Event, tokenSymbol?: string, userAddress?: string | null) => ReactNode;

/**
 * Activity type configuration
 * Defines filters for fetching events and handler for processing them
 */
export interface ActivityTypeConfig {
  contract_name: string;
  event_name: string;
  handler: ActivityHandler;
}

/**
 * Mapping from activity type name to configuration
 */
export const activityTypes: Record<string, ActivityTypeConfig> = {
  "Transfer": {
    contract_name: "Token", // Token contract emits Transfer events (inherits from ERC20)
    event_name: "Transfer",
    handler: (event: Event, tokenSymbol?: string, userAddress?: string | null) => {
      const from = event.attributes.from || event.attributes.From || "";
      const to = event.attributes.to || event.attributes.To || "";
      const value = event.attributes.value || event.attributes.Value || "0";
      
      // Format value (assuming 18 decimals for ERC20 tokens)
      const formatValue = (val: string) => {
        try {
          const formatted = formatUnits(BigInt(val), 18);
          return parseFloat(formatted).toLocaleString(undefined, {
            maximumFractionDigits: 6,
            minimumFractionDigits: 0
          });
        } catch {
          return val;
        }
      };
      
      const formatAddress = (addr: string) => {
        if (!addr) return "N/A";
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      };
      
      const isUserAddress = (addr: string) => {
        return userAddress && addr && addr.toLowerCase() === userAddress.toLowerCase();
      };
      
      return (
        <Card key={event.id}>
          <CardHeader>
            <CardTitle>Transfer</CardTitle>
            <CardDescription>{event.contract_name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">To:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${isUserAddress(to) ? "ring-2 ring-primary" : ""}`}>
                        {formatAddress(to)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{to}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={to} />
                {isUserAddress(to) && (
                  <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                    You
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">From:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${isUserAddress(from) ? "ring-2 ring-primary" : ""}`}>
                        {formatAddress(from)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{from}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={from} />
                {isUserAddress(from) && (
                  <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                    You
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Amount: </span>
              <span className="font-semibold">
                {formatValue(value)}
                {tokenSymbol && ` ${tokenSymbol}`}
              </span>
            </div>
          </CardContent>
        </Card>
      );
    },
  },
  "VoucherTransfer": {
    contract_name: "Voucher", // Voucher contract emits Transfer events (inherits from ERC20)
    event_name: "Transfer",
    handler: (event: Event, tokenSymbol?: string, userAddress?: string | null) => {
      const from = event.attributes.from || event.attributes.From || "";
      const to = event.attributes.to || event.attributes.To || "";
      const value = event.attributes.value || event.attributes.Value || "0";
      
      // Format value (assuming 18 decimals for ERC20 tokens)
      const formatValue = (val: string) => {
        try {
          const formatted = formatUnits(BigInt(val), 18);
          return parseFloat(formatted).toLocaleString(undefined, {
            maximumFractionDigits: 6,
            minimumFractionDigits: 0
          });
        } catch {
          return val;
        }
      };
      
      const formatAddress = (addr: string) => {
        if (!addr) return "N/A";
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      };
      
      const isUserAddress = (addr: string) => {
        return userAddress && addr && addr.toLowerCase() === userAddress.toLowerCase();
      };
      
      return (
        <Card key={event.id}>
          <CardHeader>
            <CardTitle>Transfer</CardTitle>
            <CardDescription>{event.contract_name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">To:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${isUserAddress(to) ? "ring-2 ring-primary" : ""}`}>
                        {formatAddress(to)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{to}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={to} />
                {isUserAddress(to) && (
                  <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                    You
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">From:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${isUserAddress(from) ? "ring-2 ring-primary" : ""}`}>
                        {formatAddress(from)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{from}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={from} />
                {isUserAddress(from) && (
                  <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                    You
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Amount: </span>
              <span className="font-semibold">
                {formatValue(value)}
                {tokenSymbol && ` ${tokenSymbol}`}
              </span>
            </div>
          </CardContent>
        </Card>
      );
    },
  },
  "Deposit": {
    contract_name: "MercataBridge",
    event_name: "DepositCompleted",
    handler: (event: Event, tokenSymbol?: string, userAddress?: string | null) => {
      const stratoRecipient = event.attributes.stratoRecipient || event.attributes.strato_recipient || "";
      const externalSender = event.attributes.externalSender || event.attributes.external_sender || "";
      const stratoTokenAmount = event.attributes.stratoTokenAmount || event.attributes.strato_token_amount || "0";
      const externalChainId = event.attributes.externalChainId || event.attributes.external_chain_id || "";
      const externalTxHash = event.attributes.externalTxHash || event.attributes.external_tx_hash || "";
      
      // Format value (assuming 18 decimals for ERC20 tokens)
      const formatValue = (val: string) => {
        try {
          const formatted = formatUnits(BigInt(val), 18);
          return parseFloat(formatted).toLocaleString(undefined, {
            maximumFractionDigits: 6,
            minimumFractionDigits: 0
          });
        } catch {
          return val;
        }
      };
      
      const formatAddress = (addr: string) => {
        if (!addr) return "N/A";
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      };
      
      const isUserAddress = (addr: string) => {
        return userAddress && addr && addr.toLowerCase() === userAddress.toLowerCase();
      };
      
      const chainName = externalChainId ? getChainName(parseInt(externalChainId)) : "Unknown Chain";
      
      return (
        <Card key={event.id}>
          <CardHeader>
            <CardTitle>Deposit Completed</CardTitle>
            <CardDescription>{event.contract_name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">To:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${isUserAddress(stratoRecipient) ? "ring-2 ring-primary" : ""}`}>
                        {formatAddress(stratoRecipient)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{stratoRecipient}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={stratoRecipient} />
                {isUserAddress(stratoRecipient) && (
                  <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                    You
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">From:</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${isUserAddress(externalSender) ? "ring-2 ring-primary" : ""}`}>
                          {formatAddress(externalSender)}
                        </code>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-mono text-xs">{externalSender}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <CopyButton address={externalSender} />
                  {isUserAddress(externalSender) && (
                    <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                      You
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">({chainName})</span>
              </div>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Amount: </span>
              <span className="font-semibold">
                {formatValue(stratoTokenAmount)}
                {tokenSymbol && ` ${tokenSymbol}`}
              </span>
            </div>
            {externalTxHash && (
              <div className="text-xs text-muted-foreground">
                <span>Tx: </span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded cursor-help">
                        {externalTxHash.slice(0, 10)}...{externalTxHash.slice(-8)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{externalTxHash}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </CardContent>
        </Card>
      );
    },
  },
};
