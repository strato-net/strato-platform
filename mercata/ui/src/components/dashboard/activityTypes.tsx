import type { Event } from "@mercata/shared-types";
import { formatUnits } from "viem";
import { getChainName } from "@/lib/bridge/utils";
import { ActivityCardData, ActivityField, ActivityTypeIcon } from "./ActivityCard";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeftRight,
  Download,
  Upload,
  Landmark,
  Gift,
  UserPlus,
  Send,
  LucideIcon
} from "lucide-react";

/**
 * Format value (assuming 18 decimals for ERC20 tokens)
 */
const formatValue = (val: string | number): string => {
  try {
    const valStr = String(val);
    if (!valStr || valStr === "0" || valStr === "null" || valStr === "undefined") {
      return "0";
    }
    const formatted = formatUnits(BigInt(valStr), 18);
    return parseFloat(formatted).toLocaleString(undefined, {
      maximumFractionDigits: 6,
      minimumFractionDigits: 0
    });
  } catch {
    return String(val);
  }
};

/**
 * Check if an address belongs to the user
 */
const isUserAddress = (addr: string, userAddress?: string | null): boolean => {
  return !!(userAddress && addr && addr.toLowerCase() === userAddress.toLowerCase());
};

/**
 * Helper to add image to a field if the address has an image
 */
const addImageToField = (
  field: ActivityField,
  address: string,
  tokenImages?: Map<string, string>,
  tokenSymbols?: Map<string, string>
): ActivityField => {
  const image = tokenImages?.get(address);
  if (image) {
    return {
      ...field,
      image,
      imageFallback: tokenSymbols?.get(address) || address,
    };
  }
  return field;
};

/**
 * Activity handler function type
 * Processes events and returns ActivityCardData
 * @param event - The event data
 * @param tokenSymbols - Map of token addresses to their symbols
 * @param userAddress - Optional user address for highlighting "You"
 * @param tokenImages - Map of token addresses to their image URLs
 */
export type ActivityHandler = (
  event: Event,
  tokenSymbols: Map<string, string>,
  userAddress?: string | null,
  tokenImages?: Map<string, string>
) => ActivityCardData;

/**
 * Function to extract token/asset address(es) from an event for fetching symbol(s)
 * @param event - The event data
 * @returns Array of token/asset addresses, or empty array if not applicable
 */
export type TokenAddressExtractor = (event: Event) => string[];

/**
 * Filter configuration for backend event filtering
 */
export type FilterConfig =
  | { type: "single"; attribute: string; excludeProtocolContracts?: boolean }
  | { type: "or"; attributes: string[]; excludeProtocolContracts?: boolean };

/**
 * Icon and color configuration for activity types
 */
export interface ActivityIconConfig {
  icon: LucideIcon;
  color: string; // Tailwind CSS color class (e.g., "bg-blue-500")
}

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
  /**
   * Filter configuration for backend event filtering
   * Defines how to filter events for "My Activity" view
   */
  filterConfig: FilterConfig;
  /**
   * Icon and color configuration for the activity type
   */
  iconConfig: ActivityIconConfig;
  /**
   * Activity type icon identifier (used in ActivityCardData)
   */
  iconType: ActivityTypeIcon;
}

/**
 * Mapping from activity type name to configuration
 */
export const activityTypes: Record<string, ActivityTypeConfig> = {
  "Transfer": {
    contract_name: "Token",
    event_name: "Transfer",
    displayName: "Transfer",
    filterConfig: { type: "or", attributes: ["from", "to"], excludeProtocolContracts: true },
    iconConfig: { icon: Send, color: "bg-blue-500" },
    iconType: "transfer",
    getTokenAddress: (event: Event) => [event.address].filter(Boolean),
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const tokenSymbol = tokenSymbols.get(event.address);
      const tokenAddress = event.address;
      const from = event.attributes.from || event.attributes.From || "";
      const to = event.attributes.to || event.attributes.To || "";
      const value = event.attributes.value || event.attributes.Value || "0";

      const fields: ActivityField[] = [
        {
          label: "To",
          value: to,
          type: "address",
          icon: "arrow-up-right",
          isUserAddress: isUserAddress(to, userAddress),
        },
        {
          label: "From",
          value: from,
          type: "address",
          icon: "arrow-down-left",
          isUserAddress: isUserAddress(from, userAddress),
        },
        addImageToField(
          {
            label: "Token",
            value: tokenAddress,
            type: "address",
            badge: tokenSymbol,
          },
          tokenAddress,
          tokenImages,
          tokenSymbols
        ),
        {
          label: "Amount",
          value: formatValue(value),
          type: "amount",
        },
      ];

      return {
        title: "Transfer",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        activityTypeIcon: "transfer",
      };
    },
  },
  "Deposit": {
    contract_name: "MercataBridge",
    event_name: "DepositCompleted",
    displayName: "Deposit",
    filterConfig: { type: "single", attribute: "stratoRecipient" },
    iconConfig: { icon: Download, color: "bg-green-500" },
    iconType: "deposit",
    getTokenAddress: (event: Event) => {
      const token = event.attributes.stratoToken || event.attributes.strato_token;
      return token ? [token] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const stratoToken = event.attributes.stratoToken || event.attributes.strato_token;
      const tokenSymbol = stratoToken ? tokenSymbols.get(stratoToken) : undefined;
      const stratoRecipient = event.attributes.stratoRecipient || event.attributes.strato_recipient || "";
      const externalSender = event.attributes.externalSender || event.attributes.external_sender || "";
      const stratoTokenAmount = event.attributes.stratoTokenAmount || event.attributes.strato_token_amount || "0";
      const externalChainId = event.attributes.externalChainId || event.attributes.external_chain_id || "";
      const externalTxHash = event.attributes.externalTxHash || event.attributes.external_tx_hash || "";

      const chainName = externalChainId ? getChainName(parseInt(externalChainId)) : "Unknown Chain";

      const fields: ActivityField[] = [
        {
          label: "To",
          value: stratoRecipient,
          type: "address",
          icon: "arrow-down",
          isUserAddress: isUserAddress(stratoRecipient, userAddress),
        },
        {
          label: "From",
          value: externalSender,
          type: "address",
          icon: "arrow-up-right",
          isUserAddress: isUserAddress(externalSender, userAddress),
          additionalContent: <span className="text-xs text-muted-foreground">({chainName})</span>,
        },
        stratoToken ? addImageToField(
          {
            label: "Token",
            value: stratoToken,
            type: "address",
            badge: tokenSymbol,
          },
          stratoToken,
          tokenImages,
          tokenSymbols
        ) : null,
        {
          label: "Amount",
          value: formatValue(stratoTokenAmount),
          type: "amount",
        },
      ].filter(Boolean) as ActivityField[];

      // Add external transaction hash as a separate field if present
      if (externalTxHash) {
        fields.push({
          label: "Tx",
          value: `${externalTxHash.slice(0, 10)}...${externalTxHash.slice(-8)}`,
          type: "text",
          tooltip: externalTxHash,
          size: "xs",
        });
      }

      return {
        title: "Deposit",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        activityTypeIcon: "deposit",
      };
    },
  },
  "Withdraw": {
    contract_name: "MercataBridge",
    event_name: "WithdrawalRequested",
    displayName: "Withdraw",
    filterConfig: { type: "single", attribute: "user" },
    iconConfig: { icon: Upload, color: "bg-red-500" },
    iconType: "withdraw",
    getTokenAddress: (event: Event) => {
      const token = event.attributes.token || event.attributes.Token;
      const externalToken = event.attributes.externalToken || event.attributes.external_token;
      const tokens: string[] = [];
      if (token) tokens.push(token);
      if (externalToken) tokens.push(externalToken);
      return tokens;
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const token = event.attributes.token || event.attributes.Token || "";
      const externalToken = event.attributes.externalToken || event.attributes.external_token;
      const tokenSymbol = token ? tokenSymbols.get(token) : undefined;
      const externalTokenSymbol = externalToken ? tokenSymbols.get(externalToken) : undefined;
      const user = event.attributes.user || event.attributes.User || "";
      const dest = event.attributes.dest || event.attributes.Dest || "";
      const destChainId = event.attributes.destChainId || event.attributes.dest_chain_id || event.attributes.destChainId || "";
      const stratoTokenAmount = event.attributes.stratoTokenAmount || event.attributes.strato_token_amount || "0";
      const externalTokenAmount = event.attributes.externalTokenAmount || event.attributes.external_token_amount || "0";

      const chainName = destChainId ? getChainName(parseInt(destChainId)) : "Unknown Chain";

      const fields: ActivityField[] = [
        {
          label: "From",
          value: user,
          type: "address",
          icon: "arrow-up-right",
          isUserAddress: isUserAddress(user, userAddress),
        },
        {
          label: "To",
          value: dest,
          type: "address",
          icon: "arrow-down",
          isUserAddress: isUserAddress(dest, userAddress),
          additionalContent: <span className="text-xs text-muted-foreground">({chainName})</span>,
        },
        externalToken ? addImageToField(
          {
            label: "External Token",
            value: externalToken,
            type: "address",
            badge: externalTokenSymbol,
          },
          externalToken,
          tokenImages,
          tokenSymbols
        ) : null,
        token ? addImageToField(
          {
            label: "Token",
            value: token,
            type: "address",
            badge: tokenSymbol,
          },
          token,
          tokenImages,
          tokenSymbols
        ) : null,
        {
          label: "Amount",
          value: formatValue(stratoTokenAmount),
          type: "amount",
        },
      ].filter(Boolean) as ActivityField[];

      return {
        title: "Withdraw",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        activityTypeIcon: "withdraw",
      };
    },
  },
  "CDPMint": {
    contract_name: "CDPEngine",
    event_name: "USDSTMinted",
    displayName: "CDP Mint",
    filterConfig: { type: "single", attribute: "owner" },
    iconConfig: { icon: Landmark, color: "bg-purple-500" },
    iconType: "cdp-mint",
    getTokenAddress: (event: Event) => {
      const asset = event.attributes.asset || event.attributes.Asset;
      return asset ? [asset] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const asset = event.attributes.asset || event.attributes.Asset || "";
      const amountUSD = event.attributes.amountUSD || event.attributes.amount_usd || "0";
      const tokenSymbol = asset ? tokenSymbols.get(asset) : undefined;

      const fields: ActivityField[] = [
        {
          label: "Borrower",
          value: owner,
          type: "address",
          icon: "arrow-up-right",
          isUserAddress: isUserAddress(owner, userAddress),
        },
        addImageToField(
          {
            label: "Collateral Asset",
            value: asset,
            type: "address",
            badge: tokenSymbol,
          },
          asset,
          tokenImages,
          tokenSymbols
        ),
        {
          label: "Amount Minted",
          value: `${formatValue(amountUSD)} USDST`,
          type: "amount",
        },
      ];

      return {
        title: "CDP Mint",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        activityTypeIcon: "cdp-mint",
      };
    },
  },
  "Swap": {
    contract_name: "Pool",
    event_name: "Swap",
    displayName: "Swap",
    filterConfig: { type: "single", attribute: "sender" },
    iconConfig: { icon: ArrowLeftRight, color: "bg-orange-500" },
    iconType: "swap",
    getTokenAddress: (event: Event) => {
      const tokenIn = event.attributes.tokenIn || event.attributes.token_in;
      const tokenOut = event.attributes.tokenOut || event.attributes.token_out;
      return [tokenIn, tokenOut].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const sender = event.attributes.sender || event.attributes.Sender || "";
      const tokenIn = event.attributes.tokenIn || event.attributes.token_in || "";
      const tokenOut = event.attributes.tokenOut || event.attributes.token_out || "";
      const amountIn = event.attributes.amountIn || event.attributes.amount_in || "0";
      const amountOut = event.attributes.amountOut || event.attributes.amount_out || "0";

      const tokenInSymbol = tokenSymbols.get(tokenIn);
      const tokenOutSymbol = tokenSymbols.get(tokenOut);

      const fields: ActivityField[] = [
        {
          label: "Sender",
          value: sender,
          type: "address",
          isUserAddress: isUserAddress(sender, userAddress),
        },
        addImageToField(
          {
            label: "In",
            value: tokenIn,
            type: "address",
            icon: "arrow-down-left",
            badge: tokenInSymbol,
            additionalContent: <span className="text-muted-foreground">({formatValue(amountIn)})</span>,
          },
          tokenIn,
          tokenImages,
          tokenSymbols
        ),
        addImageToField(
          {
            label: "Out",
            value: tokenOut,
            type: "address",
            icon: "arrow-up-right",
            badge: tokenOutSymbol,
            additionalContent: <span className="text-muted-foreground">({formatValue(amountOut)})</span>,
          },
          tokenOut,
          tokenImages,
          tokenSymbols
        ),
      ];

      return {
        title: "Swap",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        activityTypeIcon: "swap",
      };
    },
  },
  "RewardsClaimed": {
    contract_name: "Rewards",
    event_name: "RewardsClaimed",
    displayName: "Rewards Claimed",
    filterConfig: { type: "single", attribute: "user" },
    iconConfig: { icon: Gift, color: "bg-yellow-500" },
    iconType: "rewards",
    getTokenAddress: (event: Event) => {
      // The reward token address is stored in the Rewards contract, not in the event
      // We could fetch it from the contract, but for now return empty array
      // The amount will be displayed without a symbol
      return [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const user = event.attributes.user || event.attributes.User || "";
      const amount = event.attributes.amount || event.attributes.Amount || "0";

      const fields: ActivityField[] = [
        {
          label: "User",
          value: user,
          type: "address",
          icon: "arrow-down",
          isUserAddress: isUserAddress(user, userAddress),
        },
        {
          label: "Amount",
          value: `${formatValue(amount)} CATA`,
          type: "amount",
        },
      ];

      return {
        title: "Rewards Claimed",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        activityTypeIcon: "rewards",
      };
    },
  },
  "Borrow": {
    contract_name: "LendingPool",
    event_name: "Borrowed",
    displayName: "Borrow",
    filterConfig: { type: "single", attribute: "user" },
    iconConfig: { icon: Landmark, color: "bg-indigo-500" },
    iconType: "borrow",
    getTokenAddress: (event: Event) => {
      const asset = event.attributes.asset || event.attributes.Asset;
      return asset ? [asset] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const user = event.attributes.user || event.attributes.User || "";
      const asset = event.attributes.asset || event.attributes.Asset || "";
      const amount = event.attributes.amount || event.attributes.Amount || "0";
      const tokenSymbol = asset ? tokenSymbols.get(asset) : undefined;

      const fields: ActivityField[] = [
        {
          label: "Borrower",
          value: user,
          type: "address",
          icon: "arrow-up-right",
          isUserAddress: isUserAddress(user, userAddress),
        },
        addImageToField(
          {
            label: "Asset",
            value: asset,
            type: "address",
            badge: tokenSymbol,
          },
          asset,
          tokenImages,
          tokenSymbols
        ),
        {
          label: "Amount",
          value: formatValue(amount),
          type: "amount",
          badge: tokenSymbol,
        },
      ];

      return {
        title: "Borrow",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        activityTypeIcon: "borrow",
      };
    },
  },
  "ReferralRedeemed": {
    contract_name: "Escrow",
    event_name: "Redeemed",
    displayName: "Referral Redeemed",
    filterConfig: { type: "or", attributes: ["sender", "recipient"] },
    iconConfig: { icon: UserPlus, color: "bg-pink-500" },
    iconType: "referral",
    getTokenAddress: (event: Event) => {
      // Helper to normalize arrays from object format (handles Cirrus/PostgREST JSONB format)
      const normalizeToArray = (value: any): any[] => {
        if (Array.isArray(value)) {
          return value;
        }
        if (value && typeof value === 'object') {
          // Convert object like { '0': 'value1', '1': 'value2' } to array
          const keys = Object.keys(value).sort((a, b) => parseInt(a) - parseInt(b));
          return keys.map(key => value[key]);
        }
        if (typeof value === 'string') {
          // Try parsing as JSON string
          try {
            const parsed = JSON.parse(value);
            return normalizeToArray(parsed);
          } catch {
            return [];
          }
        }
        return [];
      };

      // tokens is an array in the event attributes
      const tokens = event.attributes.tokens || event.attributes.Tokens;
      const tokenArray = normalizeToArray(tokens);
      return tokenArray.filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const sender = event.attributes.sender || event.attributes.Sender || "";
      const recipient = event.attributes.recipient || event.attributes.Recipient || "";
      const tokens = event.attributes.tokens || event.attributes.Tokens || [];
      const amounts = event.attributes.amounts || event.attributes.Amounts || [];

      // Helper to normalize arrays from object format (handles Cirrus/PostgREST JSONB format)
      const normalizeToArray = (value: any): any[] => {
        if (Array.isArray(value)) {
          return value;
        }
        if (value && typeof value === 'object') {
          // Convert object like { '0': 'value1', '1': 'value2' } to array
          const keys = Object.keys(value).sort((a, b) => parseInt(a) - parseInt(b));
          return keys.map(key => value[key]);
        }
        if (typeof value === 'string') {
          // Try parsing as JSON string
          try {
            const parsed = JSON.parse(value);
            return normalizeToArray(parsed);
          } catch {
            return [];
          }
        }
        return [];
      };

      // Normalize arrays (they might be stored as objects with numeric keys)
      const tokenArray = normalizeToArray(tokens);
      const amountArray = normalizeToArray(amounts);

      // Format token amounts - show first token if available
      // Try multiple ways to access the first amount
      const firstToken = tokenArray[0] || "";
      let firstAmount: string | number | undefined = amountArray[0];

      // If amountArray is empty, try accessing amounts directly as object properties
      if (!firstAmount && amounts && typeof amounts === 'object' && !Array.isArray(amounts)) {
        firstAmount = amounts['0'] || amounts[0] || amounts['amounts.0'] || amounts['amounts[0]'];
      }

      // If still no amount, try checking if it's stored as a string representation
      if (!firstAmount && typeof amounts === 'string') {
        try {
          const parsed = JSON.parse(amounts);
          const parsedArray = normalizeToArray(parsed);
          firstAmount = parsedArray[0];
        } catch {
          // Not JSON, ignore
        }
      }

      const tokenSymbol = firstToken ? tokenSymbols.get(String(firstToken)) : undefined;
      const displayAmount = firstAmount ? formatValue(firstAmount) : "0";
      const hasMultipleTokens = tokenArray.length > 1;

      // Build list of all token amounts for tooltip
      const allTokenAmounts = tokenArray.map((token, index) => {
        const amount = amountArray[index];
        const symbol = token ? tokenSymbols.get(String(token)) : undefined;
        const formattedAmount = amount ? formatValue(amount) : "0";
        return {
          token,
          amount: formattedAmount,
          symbol: symbol || "TOKEN"
        };
      });

      // Format first token address for display if no symbol
      const formatAddress = (addr: string): string => {
        if (!addr) return "N/A";
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      };

      const amountDisplay = tokenSymbol
        ? `${displayAmount} ${tokenSymbol}`
        : firstToken
        ? `${displayAmount} (${formatAddress(firstToken)})`
        : displayAmount;

      const additionalContent = hasMultipleTokens ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground cursor-help ml-1">
                +{tokenArray.length - 1} more
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <div className="space-y-1">
                <p className="font-semibold text-xs mb-2">All tokens:</p>
                {allTokenAmounts.map((item, index) => (
                  <div key={index} className="text-xs">
                    <span className="font-medium">
                      {item.amount} {item.symbol !== "TOKEN" ? item.symbol : `(${formatAddress(item.token)})`}
                    </span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : undefined;

      const fields: ActivityField[] = [
        {
          label: "Referred By",
          value: sender,
          type: "address",
          icon: "arrow-down-left",
          isUserAddress: isUserAddress(sender, userAddress),
        },
        {
          label: "Referred User",
          value: recipient,
          type: "address",
          icon: "arrow-up-right",
          isUserAddress: isUserAddress(recipient, userAddress),
        },
        firstToken ? addImageToField(
          {
            label: "Token",
            value: String(firstToken),
            type: "address",
            badge: tokenSymbol,
          },
          String(firstToken),
          tokenImages,
          tokenSymbols
        ) : null,
        {
          label: "Amount",
          value: displayAmount,
          type: "amount",
          additionalContent,
        },
      ].filter(Boolean) as ActivityField[];

      return {
        title: "Referral Redeemed",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        activityTypeIcon: "referral",
      };
    },
  },
};

/**
 * Get icon and color configuration for an activity type icon
 * @param iconType - The activity type icon identifier
 * @returns Icon and color configuration, or default if not found
 */
export const getActivityIconConfig = (iconType?: ActivityTypeIcon): ActivityIconConfig => {
  if (!iconType) {
    return { icon: ArrowLeftRight, color: "bg-gray-500" };
  }

  // Find the activity type config that matches this iconType
  const matchingConfig = Object.values(activityTypes).find(
    config => config.iconType === iconType
  );

  if (matchingConfig) {
    return matchingConfig.iconConfig;
  }

  // Default fallback
  return { icon: ArrowLeftRight, color: "bg-gray-500" };
};
