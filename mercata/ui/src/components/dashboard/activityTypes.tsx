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
 * @param tokenSymbols - Map of token addresses to their symbols
 * @param userAddress - Optional user address for highlighting "You"
 */
export type ActivityHandler = (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null) => ReactNode;

/**
 * Function to extract token/asset address(es) from an event for fetching symbol(s)
 * @param event - The event data
 * @returns Array of token/asset addresses, or empty array if not applicable
 */
export type TokenAddressExtractor = (event: Event) => string[];

/**
 * Activity type configuration
 * Defines filters for fetching events and handler for processing them
 */
export interface ActivityTypeConfig {
  contract_name: string;
  event_name: string;
  handler: ActivityHandler;
  /**
   * Display name for the activity type (used in dropdowns, etc.)
   * If not provided, the activity type key will be used
   */
  displayName?: string;
  /**
   * Optional function to extract token/asset address from event for fetching symbol
   * If not provided, no symbol will be fetched for this activity type
   */
  getTokenAddress?: TokenAddressExtractor;
}

/**
 * Mapping from activity type name to configuration
 */
export const activityTypes: Record<string, ActivityTypeConfig> = {
  "Transfer": {
    contract_name: "Token", // Token contract emits Transfer events (inherits from ERC20)
    event_name: "Transfer",
    displayName: "Transfer",
    getTokenAddress: (event: Event) => [event.address].filter(Boolean),
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null) => {
      const tokenSymbol = tokenSymbols.get(event.address);
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
    displayName: "Voucher Transfer",
    getTokenAddress: (event: Event) => [event.address].filter(Boolean),
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null) => {
      const tokenSymbol = tokenSymbols.get(event.address);
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
    displayName: "Deposit",
    getTokenAddress: (event: Event) => {
      const token = event.attributes.stratoToken || event.attributes.strato_token;
      return token ? [token] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null) => {
      const stratoToken = event.attributes.stratoToken || event.attributes.strato_token;
      const tokenSymbol = stratoToken ? tokenSymbols.get(stratoToken) : undefined;
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
  "CDPMint": {
    contract_name: "CDPEngine",
    event_name: "USDSTMinted",
    displayName: "CDP Mint",
    getTokenAddress: (event: Event) => {
      const asset = event.attributes.asset || event.attributes.Asset;
      return asset ? [asset] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null) => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const asset = event.attributes.asset || event.attributes.Asset || "";
      const amountUSD = event.attributes.amountUSD || event.attributes.amount_usd || "0";
      const tokenSymbol = asset ? tokenSymbols.get(asset) : undefined;
      
      // Format value (USDST has 18 decimals)
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
            <CardTitle>CDP Mint</CardTitle>
            <CardDescription>{event.contract_name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Owner:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${isUserAddress(owner) ? "ring-2 ring-primary" : ""}`}>
                        {formatAddress(owner)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{owner}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={owner} />
                {isUserAddress(owner) && (
                  <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                    You
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Collateral Asset:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className="text-xs bg-muted px-2 py-1 rounded cursor-help">
                        {formatAddress(asset)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{asset}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={asset} />
                {tokenSymbol && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {tokenSymbol}
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Amount Minted: </span>
              <span className="font-semibold">
                {formatValue(amountUSD)} USDST
              </span>
            </div>
          </CardContent>
        </Card>
      );
    },
  },
  "Swap": {
    contract_name: "Pool",
    event_name: "Swap",
    displayName: "Swap",
    getTokenAddress: (event: Event) => {
      const tokenIn = event.attributes.tokenIn || event.attributes.token_in;
      const tokenOut = event.attributes.tokenOut || event.attributes.token_out;
      return [tokenIn, tokenOut].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null) => {
      const sender = event.attributes.sender || event.attributes.Sender || "";
      const tokenIn = event.attributes.tokenIn || event.attributes.token_in || "";
      const tokenOut = event.attributes.tokenOut || event.attributes.token_out || "";
      const amountIn = event.attributes.amountIn || event.attributes.amount_in || "0";
      const amountOut = event.attributes.amountOut || event.attributes.amount_out || "0";
      
      const tokenInSymbol = tokenSymbols.get(tokenIn);
      const tokenOutSymbol = tokenSymbols.get(tokenOut);
      
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
            <CardTitle>Swap</CardTitle>
            <CardDescription>{event.contract_name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Sender:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${isUserAddress(sender) ? "ring-2 ring-primary" : ""}`}>
                        {formatAddress(sender)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{sender}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={sender} />
                {isUserAddress(sender) && (
                  <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                    You
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">In:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className="text-xs bg-muted px-2 py-1 rounded cursor-help">
                        {formatAddress(tokenIn)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{tokenIn}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={tokenIn} />
                {tokenInSymbol && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {tokenInSymbol}
                  </Badge>
                )}
              </div>
              <span className="text-muted-foreground">({formatValue(amountIn)})</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Out:</span>
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className="text-xs bg-muted px-2 py-1 rounded cursor-help">
                        {formatAddress(tokenOut)}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{tokenOut}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CopyButton address={tokenOut} />
                {tokenOutSymbol && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {tokenOutSymbol}
                  </Badge>
                )}
              </div>
              <span className="text-muted-foreground">({formatValue(amountOut)})</span>
            </div>
          </CardContent>
        </Card>
      );
    },
  },
};
