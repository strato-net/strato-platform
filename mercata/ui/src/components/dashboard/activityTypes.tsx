import type { Event } from "@mercata/shared-types";
import { formatUnits } from "viem";
import { getChainName, getExplorerUrl } from "@/lib/bridge/utils";
import { ActivityCardData, ActivityField, LayoutConfig } from "./ActivityCard";
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
  Coins,
  Plus,
  LucideIcon
} from "lucide-react";
import { usdstAddress } from "@/lib/constants";

/**
 * Format value with consistent decimals (2 for USDST, 4 for others)
 * @param val - The raw value as string or number
 * @param tokenAddress - Optional token address to determine decimals
 * @returns Formatted value string
 */
const formatValue = (val: string | number, tokenAddress?: string): string => {
  try {
    const valStr = String(val);
    if (!valStr || valStr === "0" || valStr === "null" || valStr === "undefined") {
      return "0";
    }
    const formatted = formatUnits(BigInt(valStr), 18);
    const numValue = parseFloat(formatted);

    // Determine decimal places: 2 for USDST, 4 for others
    const decimals = tokenAddress?.toLowerCase() === usdstAddress.toLowerCase() ? 2 : 4;

    return numValue.toLocaleString(undefined, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals
    });
  } catch {
    return String(val);
  }
};

/**
 * Get the full formatted amount for tooltip display
 */
const getFullAmount = (val: string | number): string => {
  try {
    const valStr = String(val);
    if (!valStr || valStr === "0" || valStr === "null" || valStr === "undefined") {
      return "0";
    }
    const formatted = formatUnits(BigInt(valStr), 18);
    return parseFloat(formatted).toLocaleString(undefined, {
      maximumFractionDigits: 18,
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
  | { type: "single"; attribute: string }
  | { type: "or"; attributes: string[] };

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
}

/**
 * Mapping from activity type name to configuration
 */
export const activityTypes: Record<string, ActivityTypeConfig> = {
  "Transfer": {
    contract_name: "Token",
    event_name: "Transfer",
    displayName: "Transfer",
    filterConfig: { type: "or", attributes: ["from", "to"] },
    iconConfig: { icon: Send, color: "bg-blue-500" },
    getTokenAddress: (event: Event) => [event.address].filter(Boolean),
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const tokenSymbol = tokenSymbols.get(event.address);
      const tokenAddress = event.address;
      const from = event.attributes.from || event.attributes.From || "";
      const to = event.attributes.to || event.attributes.To || "";
      const value = event.attributes.value || event.attributes.Value || "0";

      const tokenImage = tokenImages?.get(tokenAddress);

      const fields: ActivityField[] = [
        {
          label: "Amount",
          value: formatValue(value, tokenAddress),
          type: "amount",
          badge: tokenSymbol,
          image: tokenImage,
          imageFallback: tokenSymbol || tokenAddress,
          rawAmount: getFullAmount(value),
        },
        {
          label: "From",
          value: from,
          type: "address",
          isUserAddress: isUserAddress(from, userAddress),
        },
        {
          label: "To",
          value: to,
          type: "address",
          isUserAddress: isUserAddress(to, userAddress),
        },
      ];

      return {
        title: "Transfer",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["From", "To"],
            renderer: "addresses-with-arrow",
          },
        },
      };
    },
  },
  "Deposit": {
    contract_name: "MercataBridge",
    event_name: "DepositCompleted",
    displayName: "Deposit",
    filterConfig: { type: "single", attribute: "stratoRecipient" },
    iconConfig: { icon: Download, color: "bg-green-500" },
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

      const stratoTokenImage = stratoToken ? tokenImages?.get(stratoToken) : undefined;

      const fields: ActivityField[] = [
        // Amount first (for line 1)
        stratoToken ? {
          label: "Amount",
          value: formatValue(stratoTokenAmount, stratoToken),
          type: "amount",
          badge: tokenSymbol,
          image: stratoTokenImage,
          imageFallback: tokenSymbol || stratoToken,
          rawAmount: getFullAmount(stratoTokenAmount),
        } : null,
        // From, To, Tx for line 2
        {
          label: "From",
          value: externalSender,
          type: "address",
          icon: "arrow-up-right",
          isUserAddress: isUserAddress(externalSender, userAddress),
          additionalContent: <span className="text-xs text-muted-foreground">({chainName})</span>,
        },
        {
          label: "To",
          value: stratoRecipient,
          type: "address",
          icon: "arrow-down",
          isUserAddress: isUserAddress(stratoRecipient, userAddress),
        },
        // Tx hash if present
        externalTxHash ? {
          label: "Tx",
          value: `${externalTxHash.slice(0, 10)}...${externalTxHash.slice(-8)}`,
          type: "text",
          tooltip: externalTxHash,
          size: "xs",
          explorerUrl: externalChainId ? getExplorerUrl(externalChainId, externalTxHash): undefined,
        } : null,
      ].filter(Boolean) as ActivityField[];

      return {
        title: "Deposit",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: externalTxHash ? ["From", "To", "Tx"] : ["From", "To"],
            renderer: externalTxHash ? "addresses-with-arrow-and-text" : "addresses-with-arrow",
          },
        },
      };
    },
  },
  "Withdraw": {
    contract_name: "MercataBridge",
    event_name: "WithdrawalRequested",
    displayName: "Withdrawal",
    filterConfig: { type: "single", attribute: "user" },
    iconConfig: { icon: Upload, color: "bg-red-500" },
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

      const tokenImage = token ? tokenImages?.get(token) : undefined;
      const externalTokenImage = externalToken ? tokenImages?.get(externalToken) : undefined;

      const fields: ActivityField[] = [
        // Amount first (for line 1)
        token ? {
          label: "Amount",
          value: formatValue(stratoTokenAmount, token),
          type: "amount",
          badge: tokenSymbol,
          image: tokenImage,
          imageFallback: tokenSymbol || token,
          rawAmount: getFullAmount(stratoTokenAmount),
        } : null,
        // From, To, External Token for line 2
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
        // External Token if present
        externalToken ? {
          label: "External Token",
          value: externalToken,
          type: "address",
          badge: externalTokenSymbol,
          image: externalTokenImage,
          imageFallback: externalTokenSymbol || externalToken,
        } : null,
      ].filter(Boolean) as ActivityField[];

      // Build line2 field labels based on what's present
      const line2FieldLabels = ["From", "To"];
      if (externalToken) {
        line2FieldLabels.push("External Token");
      }

      return {
        title: "Withdrawal",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: line2FieldLabels,
            renderer: externalToken ? "addresses-with-arrow-and-text" : "addresses-with-arrow",
          },
        },
      };
    },
  },
  "CDPMint": {
    contract_name: "CDPEngine",
    event_name: "USDSTMinted",
    displayName: "CDP Mint",
    filterConfig: { type: "single", attribute: "owner" },
    iconConfig: { icon: Landmark, color: "bg-purple-500" },
    getTokenAddress: (event: Event) => {
      const asset = event.attributes.asset || event.attributes.Asset;
      // Include USDST since the minted amount is always USDST
      return asset ? [asset, usdstAddress] : [usdstAddress];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const asset = (event.attributes.asset || event.attributes.Asset || "").toLowerCase();
      const amountUSD = event.attributes.amountUSD || event.attributes.amount_usd || "0";
      const tokenSymbol = asset ? tokenSymbols.get(asset) : undefined;

      const usdstImage = tokenImages?.get(usdstAddress.toLowerCase());
      const usdstSymbol = tokenSymbols.get(usdstAddress.toLowerCase()) || "USDST";

      const assetImage = asset ? tokenImages?.get(asset) : undefined;

      const fields: ActivityField[] = [
        {
          label: "Amount Minted",
          value: formatValue(amountUSD, usdstAddress),
          type: "amount",
          badge: usdstSymbol,
          image: usdstImage,
          imageFallback: usdstSymbol,
          rawAmount: getFullAmount(amountUSD),
        },
        {
          label: "Borrower",
          value: owner,
          type: "address",
          isUserAddress: isUserAddress(owner, userAddress),
        },
        {
          label: "Collateral Asset",
          value: asset,
          type: "address",
          badge: tokenSymbol,
          image: assetImage,
          imageFallback: tokenSymbol || asset,
        },
      ];

      return {
        title: "CDP Mint",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount Minted"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Borrower", "Collateral Asset"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "Swap": {
    contract_name: "Pool",
    event_name: "Swap",
    displayName: "Swap",
    filterConfig: { type: "single", attribute: "sender" },
    iconConfig: { icon: ArrowLeftRight, color: "bg-orange-500" },
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
      const tokenInImage = tokenImages?.get(tokenIn);
      const tokenOutImage = tokenImages?.get(tokenOut);

      const fields: ActivityField[] = [
        // Amount In (for line 1)
        {
          label: "Amount In",
          value: formatValue(amountIn, tokenIn),
          type: "amount",
          badge: tokenInSymbol,
          image: tokenInImage,
          imageFallback: tokenInSymbol || tokenIn,
          rawAmount: getFullAmount(amountIn),
        },
        // Amount Out (for line 1)
        {
          label: "Amount Out",
          value: formatValue(amountOut, tokenOut),
          type: "amount",
          badge: tokenOutSymbol,
          image: tokenOutImage,
          imageFallback: tokenOutSymbol || tokenOut,
          rawAmount: getFullAmount(amountOut),
        },
        // By (for line 2)
        {
          label: "By",
          value: sender,
          type: "address",
          isUserAddress: isUserAddress(sender, userAddress),
        },
      ];

      return {
        title: "Swap",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount In", "Amount Out"],
            renderer: "amounts-with-arrow",
          },
          line2: {
            fieldLabels: ["By"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "AddLiquidity": {
    contract_name: "Pool",
    event_name: "AddLiquidity",
    displayName: "Add Liquidity",
    filterConfig: { type: "single", attribute: "provider" },
    iconConfig: { icon: Plus, color: "bg-green-700" },
    getTokenAddress: (event: Event) => {
      // Token addresses aren't in the event, but we'll fetch them from the pool
      // Return empty array - pool tokens will be fetched separately in ActivityFeedCards
      return [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const provider = event.attributes.provider || event.attributes.Provider || "";
      const tokenBAmount = event.attributes.tokenBAmount || event.attributes.token_b_amount || event.attributes.tokenB || "0";
      const tokenAAmount = event.attributes.tokenAAmount || event.attributes.token_a_amount || event.attributes.tokenA || "0";

      // Get token addresses from event metadata if available (set by ActivityFeedCards)
      const tokenA = (event as any).tokenA || "";
      const tokenB = (event as any).tokenB || "";

      // Normalize addresses for lookup (try both original and lowercase)
      const tokenANormalized = tokenA ? tokenA.toLowerCase() : "";
      const tokenBNormalized = tokenB ? tokenB.toLowerCase() : "";

      const tokenASymbol = tokenA ? (tokenSymbols.get(tokenA) || tokenSymbols.get(tokenANormalized)) : undefined;
      const tokenBSymbol = tokenB ? (tokenSymbols.get(tokenB) || tokenSymbols.get(tokenBNormalized)) : undefined;
      const tokenAImage = tokenA ? (tokenImages?.get(tokenA) || tokenImages?.get(tokenANormalized)) : undefined;
      const tokenBImage = tokenB ? (tokenImages?.get(tokenB) || tokenImages?.get(tokenBNormalized)) : undefined;

      const fields: ActivityField[] = [
        // Token A Amount (for line 1)
        {
          label: "Token A Amount",
          value: formatValue(tokenAAmount, tokenA),
          type: "amount",
          badge: tokenASymbol,
          image: tokenAImage,
          imageFallback: tokenASymbol || tokenA || "Token A",
          rawAmount: getFullAmount(tokenAAmount),
        },
        // Token B Amount (for line 1)
        {
          label: "Token B Amount",
          value: formatValue(tokenBAmount, tokenB),
          type: "amount",
          badge: tokenBSymbol,
          image: tokenBImage,
          imageFallback: tokenBSymbol || tokenB || "Token B",
          rawAmount: getFullAmount(tokenBAmount),
        },
        // Provider (for line 2)
        {
          label: "Provider",
          value: provider,
          type: "address",
          isUserAddress: isUserAddress(provider, userAddress),
        },
      ];

      return {
        title: "Add Liquidity",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Token A Amount", "Token B Amount"],
            renderer: "amounts-with-and",
          },
          line2: {
            fieldLabels: ["Provider"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "RewardsClaimed": {
    contract_name: "Rewards",
    event_name: "RewardsClaimed",
    displayName: "Rewards Claimed",
    filterConfig: { type: "single", attribute: "user" },
    iconConfig: { icon: Gift, color: "bg-gradient-to-br from-emerald-400 to-teal-500" },
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
        // Amount first (for line 1)
        {
          label: "Amount",
          value: formatValue(amount),
          type: "amount",
          badge: "points",
          rawAmount: getFullAmount(amount),
        },
        // Claimed By for line 2
        {
          label: "Claimed By",
          value: user,
          type: "address",
          icon: "arrow-down",
          isUserAddress: isUserAddress(user, userAddress),
        },
      ];

      return {
        title: "Rewards Claimed",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Claimed By"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "Borrow": {
    contract_name: "LendingPool",
    event_name: "Borrowed",
    displayName: "Borrow",
    filterConfig: { type: "single", attribute: "user" },
    iconConfig: { icon: Landmark, color: "bg-indigo-500" },
    getTokenAddress: (event: Event) => {
      const asset = event.attributes.asset || event.attributes.Asset;
      return asset ? [asset] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const user = event.attributes.user || event.attributes.User || "";
      const asset = event.attributes.asset || event.attributes.Asset || "";
      const amount = event.attributes.amount || event.attributes.Amount || "0";
      const tokenSymbol = asset ? tokenSymbols.get(asset) : undefined;

      const tokenImage = asset ? tokenImages?.get(asset) : undefined;

      const fields: ActivityField[] = [
        {
          label: "Amount",
          value: formatValue(amount, asset),
          type: "amount",
          badge: tokenSymbol,
          image: tokenImage,
          imageFallback: tokenSymbol || asset,
          rawAmount: getFullAmount(amount),
        },
        {
          label: "Borrower",
          value: user,
          type: "address",
          isUserAddress: isUserAddress(user, userAddress),
        },
      ];

      return {
        title: "Borrow",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Borrower"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "LiquidityDeposited": {
    contract_name: "LendingPool",
    event_name: "Deposited",
    displayName: "Savings",
    filterConfig: { type: "single", attribute: "user" },
    iconConfig: { icon: Coins, color: "bg-emerald-500" },
    getTokenAddress: (event: Event) => {
      const asset = event.attributes.asset || event.attributes.Asset;
      return asset ? [asset] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const user = event.attributes.user || event.attributes.User || "";
      const asset = event.attributes.asset || event.attributes.Asset || "";
      const amount = event.attributes.amount || event.attributes.Amount || "0";
      const tokenSymbol = asset ? tokenSymbols.get(asset) : undefined;

      const tokenImage = asset ? tokenImages?.get(asset) : undefined;

      const fields: ActivityField[] = [
        {
          label: "Amount",
          value: formatValue(amount, asset),
          type: "amount",
          badge: tokenSymbol,
          image: tokenImage,
          imageFallback: tokenSymbol || asset,
          rawAmount: getFullAmount(amount),
        },
        {
          label: "Depositor",
          value: user,
          type: "address",
          isUserAddress: isUserAddress(user, userAddress),
        },
      ];

      return {
        title: "Savings",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Depositor"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "ReferralRedeemed": {
    contract_name: "Escrow",
    event_name: "Redeemed",
    displayName: "Referral Redeemed",
    filterConfig: { type: "or", attributes: ["sender", "recipient"] },
    iconConfig: { icon: UserPlus, color: "bg-pink-500" },
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
      const displayAmount = firstAmount ? formatValue(firstAmount, String(firstToken)) : "0";
      const hasMultipleTokens = tokenArray.length > 1;

      // Build list of all token amounts for tooltip
      const allTokenAmounts = tokenArray.map((token, index) => {
        const amount = amountArray[index];
        const symbol = token ? tokenSymbols.get(String(token)) : undefined;
        const formattedAmount = amount ? formatValue(amount, String(token)) : "0";
        const fullAmount = amount ? getFullAmount(amount) : "0";
        return {
          token,
          amount: formattedAmount,
          fullAmount,
          symbol: symbol || "TOKEN"
        };
      });

      // Format first token address for display if no symbol
      const formatAddress = (addr: string): string => {
        if (!addr) return "N/A";
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      };

      // displayAmount already includes formatting with token address, just use it directly
      const amountDisplay = displayAmount;

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
                      {item.fullAmount} {item.symbol !== "TOKEN" ? item.symbol : `(${formatAddress(item.token)})`}
                    </span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : undefined;

      const fields: ActivityField[] = [
        // Amount first (for line 1)
        firstToken ? {
          label: "Amount",
          value: displayAmount,
          type: "amount",
          badge: tokenSymbol,
          image: tokenImages?.get(String(firstToken)),
          imageFallback: tokenSymbol || String(firstToken),
          rawAmount: firstAmount ? getFullAmount(firstAmount) : undefined,
          additionalContent,
        } : null,
        // Referred By and Referred User for line 2
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
      ].filter(Boolean) as ActivityField[];

      return {
        title: "Referral Redeemed",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Amount"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Referred By", "Referred User"],
            renderer: "addresses-with-arrow",
          },
        },
      };
    },
  },
};

