import type { Event } from "@strato/shared-types";
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
  Minus,
  Banknote,
  Gem,
  Clock,
  CheckCircle,
  ShieldCheck,
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
const normalizeAddress = (addr?: string | null): string => (addr || "").toLowerCase().replace(/^0x/, "");

const isUserAddress = (addr: string, userAddress?: string | null): boolean => {
  return !!(userAddress && addr && normalizeAddress(addr) === normalizeAddress(userAddress));
};

/**
 * Title and icon for a transfer based on the user's role:
 * "Receive" when the user is the recipient, "Send" otherwise
 */
const transferDirection = (
  from: string,
  to: string,
  userAddress?: string | null
): Pick<ActivityCardData, "title" | "iconConfig"> =>
  isUserAddress(to, userAddress) && !isUserAddress(from, userAddress)
    ? { title: "Receive", iconConfig: { icon: Download, color: "bg-green-500" } }
    : { title: "Send", iconConfig: { icon: Send, color: "bg-blue-500" } };

const getEventAttribute = (event: Event, ...names: string[]): string => {
  for (const name of names) {
    const value = event.attributes[name];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
};

const formatUnixSeconds = (value: string): string => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";

  return new Date(seconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const stratoAmountField = (label: string, amount: string): ActivityField => ({
  label,
  value: formatValue(amount),
  type: "amount",
  badge: "STRATO",
  rawAmount: getFullAmount(amount),
});

const usdstFeeField = (label: string, amount: string): ActivityField => ({
  label,
  value: formatValue(amount, usdstAddress),
  type: "amount",
  badge: "USDST",
  rawAmount: getFullAmount(amount),
});

// Validator-lifecycle cards share one shape: the operator address plus a note.
const stratoValidatorCard = (
  title: string,
  event: Event,
  userAddress: string | null | undefined,
  note?: string
): ActivityCardData => {
  const operator = getEventAttribute(event, "operator", "Operator");
  const fields: ActivityField[] = [addressField("Operator", operator, userAddress)];
  if (note) fields.push({ label: "Note", value: note, type: "text" });
  return {
    title,
    fields,
    timestamp: event.block_timestamp || "",
    eventId: event.id?.toString(),
    layout: {
      type: "two-line",
      line1: { fieldLabels: note ? ["Note"] : ["Operator"] },
      line2: { fieldLabels: ["Operator"], renderer: "addresses-with-bullet" },
    },
  };
};

const addressField = (label: string, value: string, userAddress?: string | null): ActivityField => ({
  label,
  value,
  type: "address",
  isUserAddress: isUserAddress(value, userAddress),
});

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
 * Processes events and returns ActivityCardData, or null to skip the event
 * (e.g. bookkeeping-only events like a zero-amount PoolV3 poke burn)
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
) => ActivityCardData | null;

/**
 * Function to extract token/asset address(es) from an event for fetching symbol(s)
 * @param event - The event data
 * @returns Array of token/asset addresses, or empty array if not applicable
 */
export type TokenAddressExtractor = (event: Event) => string[];

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
    displayName: "Send / Receive",
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
        ...transferDirection(from, to, userAddress),
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
  "YieldVaultTransfer": {
    contract_name: "YieldVault",
    event_name: "Transfer",
    displayName: "Send / Receive",
    iconConfig: { icon: Send, color: "bg-blue-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const vaultName = tokenSymbols.get(event.address) || tokenSymbols.get(normalizeAddress(event.address));
      const from = event.attributes.from || event.attributes.From || "";
      const to = event.attributes.to || event.attributes.To || "";
      const value = event.attributes.value || event.attributes.Value || "0";

      const fields: ActivityField[] = [
        {
          label: "Amount",
          value: formatValue(value),
          type: "amount",
          badge: vaultName || "shares",
          rawAmount: getFullAmount(value),
          className: "pb-1",
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
        ...transferDirection(from, to, userAddress),
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
  "SaveUSDSTVaultTransfer": {
    contract_name: "SaveUSDSTVault",
    event_name: "Transfer",
    displayName: "Send / Receive",
    iconConfig: { icon: Send, color: "bg-blue-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const from = event.attributes.from || event.attributes.From || "";
      const to = event.attributes.to || event.attributes.To || "";
      const value = event.attributes.value || event.attributes.Value || "0";

      const fields: ActivityField[] = [
        {
          label: "Amount",
          value: formatValue(value),
          type: "amount",
          badge: "SaveUSDST shares",
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
        ...transferDirection(from, to, userAddress),
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
  "SaveUSDSTDeposit": {
    contract_name: "SaveUSDSTVault",
    event_name: "Deposit",
    displayName: "SaveUSDST Deposit",
    iconConfig: { icon: Download, color: "bg-cyan-500" },
    getTokenAddress: () => [usdstAddress],
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const assets = event.attributes.assets || event.attributes.Assets || "0";
      const shares = event.attributes.shares || event.attributes.Shares || "0";
      const usdstSymbol = tokenSymbols.get(usdstAddress) || "USDST";

      const fields: ActivityField[] = [
        {
          label: "Deposited",
          value: formatValue(assets, usdstAddress),
          type: "amount",
          badge: usdstSymbol,
          image: tokenImages?.get(usdstAddress),
          imageFallback: usdstSymbol,
          rawAmount: getFullAmount(assets),
        },
        {
          label: "Shares Minted",
          value: formatValue(shares),
          type: "text",
          badge: "shares",
        },
        {
          label: "Depositor",
          value: owner,
          type: "address",
          isUserAddress: isUserAddress(owner, userAddress),
        },
      ];

      return {
        title: "SaveUSDST Deposit",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Deposited"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Depositor", "Shares Minted"],
          },
        },
      };
    },
  },
  "SaveUSDSTWithdraw": {
    contract_name: "SaveUSDSTVault",
    event_name: "Withdraw",
    displayName: "SaveUSDST Withdraw",
    iconConfig: { icon: Upload, color: "bg-cyan-600" },
    getTokenAddress: () => [usdstAddress],
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const receiver = event.attributes.receiver || event.attributes.Receiver || "";
      const assets = event.attributes.assets || event.attributes.Assets || "0";
      const usdstSymbol = tokenSymbols.get(usdstAddress) || "USDST";

      const fields: ActivityField[] = [
        {
          label: "Withdrawn",
          value: formatValue(assets, usdstAddress),
          type: "amount",
          badge: usdstSymbol,
          image: tokenImages?.get(usdstAddress),
          imageFallback: usdstSymbol,
          rawAmount: getFullAmount(assets),
        },
        {
          label: "Owner",
          value: owner,
          type: "address",
          isUserAddress: isUserAddress(owner, userAddress),
        },
        {
          label: "Receiver",
          value: receiver,
          type: "address",
          isUserAddress: isUserAddress(receiver, userAddress),
        },
      ];

      return {
        title: "SaveUSDST Withdraw",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Withdrawn"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Owner", "Receiver"],
            renderer: "addresses-with-arrow",
          },
        },
      };
    },
  },
  "DirectPSMMint": {
    contract_name: "DirectMintPSM",
    event_name: "DirectPSMMinted",
    displayName: "PSM Mint",
    iconConfig: { icon: Coins, color: "bg-indigo-500" },
    getTokenAddress: (event: Event) => {
      const againstToken = event.attributes.againstToken || event.attributes.against_token;
      return [usdstAddress, againstToken].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const user = getEventAttribute(event, "user", "User");
      const againstToken = getEventAttribute(event, "againstToken", "against_token");
      // depositAmount is the gross collateral pulled in; mintAmount is net of the PSM fee
      const depositAmount = getEventAttribute(event, "depositAmount", "deposit_amount") || "0";
      const mintAmount = getEventAttribute(event, "mintAmount", "mint_amount") || "0";

      const collateralSymbol = tokenSymbols.get(againstToken);
      const usdstSymbol = tokenSymbols.get(usdstAddress) || "USDST";

      const fields: ActivityField[] = [
        {
          label: "Deposited",
          value: formatValue(depositAmount, againstToken),
          type: "amount",
          badge: collateralSymbol,
          image: tokenImages?.get(againstToken),
          imageFallback: collateralSymbol || againstToken,
          rawAmount: getFullAmount(depositAmount),
        },
        {
          label: "Minted",
          value: formatValue(mintAmount, usdstAddress),
          type: "amount",
          badge: usdstSymbol,
          image: tokenImages?.get(usdstAddress),
          imageFallback: usdstSymbol,
          rawAmount: getFullAmount(mintAmount),
        },
        addressField("By", user, userAddress),
      ];

      return {
        title: "PSM Mint",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Deposited", "Minted"],
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
  "DirectPSMRedeem": {
    contract_name: "DirectMintPSM",
    event_name: "Redeemed",
    displayName: "PSM Redeem",
    iconConfig: { icon: Banknote, color: "bg-indigo-600" },
    getTokenAddress: (event: Event) => {
      const redeemToken = event.attributes.redeemToken || event.attributes.redeem_token;
      return [usdstAddress, redeemToken].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const user = getEventAttribute(event, "user", "User");
      const redeemToken = getEventAttribute(event, "redeemToken", "redeem_token");
      // burnAmount is the gross USDST burned; payoutAmount is net of the PSM fee
      const burnAmount = getEventAttribute(event, "burnAmount", "burn_amount") || "0";
      const payoutAmount = getEventAttribute(event, "payoutAmount", "payout_amount") || "0";

      const redeemSymbol = tokenSymbols.get(redeemToken);
      const usdstSymbol = tokenSymbols.get(usdstAddress) || "USDST";

      const fields: ActivityField[] = [
        {
          label: "Burned",
          value: formatValue(burnAmount, usdstAddress),
          type: "amount",
          badge: usdstSymbol,
          image: tokenImages?.get(usdstAddress),
          imageFallback: usdstSymbol,
          rawAmount: getFullAmount(burnAmount),
        },
        {
          label: "Received",
          value: formatValue(payoutAmount, redeemToken),
          type: "amount",
          badge: redeemSymbol,
          image: tokenImages?.get(redeemToken),
          imageFallback: redeemSymbol || redeemToken,
          rawAmount: getFullAmount(payoutAmount),
        },
        addressField("By", user, userAddress),
      ];

      return {
        title: "PSM Redeem",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Burned", "Received"],
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
  "Deposit": {
    contract_name: "MercataBridge",
    event_name: "DepositCompleted",
    displayName: "Non-native Deposit",
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
        title: "Non-native Deposit",
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
  "NativeDeposit": {
    contract_name: "StratoNativeBridge",
    event_name: "NativeDepositCompleted",
    displayName: "Native Deposit",
    iconConfig: { icon: Download, color: "bg-green-500" },
    getTokenAddress: (event: Event) => {
      const token = event.attributes.stratoToken || event.attributes.strato_token;
      return token ? [token] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => ({
      ...activityTypes.Deposit.handler(event, tokenSymbols, userAddress, tokenImages),
      title: "Native Deposit",
    }),
  },
  "Withdraw": {
    contract_name: "MercataBridge",
    event_name: "WithdrawalRequested",
    displayName: "Non-native Bridge Out",
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
        title: "Non-native Bridge Out",
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
  "NativeWithdraw": {
    contract_name: "StratoNativeBridge",
    event_name: "NativeWithdrawalRequested",
    displayName: "Native Bridge Out",
    iconConfig: { icon: Upload, color: "bg-red-500" },
    getTokenAddress: (event: Event) => {
      const token = event.attributes.stratoToken || event.attributes.strato_token;
      const externalToken = event.attributes.representationToken || event.attributes.representation_token;
      return [token, externalToken].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const attributes = event.attributes;
      const normalizedEvent = {
        ...event,
        attributes: {
          ...attributes,
          token: attributes.stratoToken || attributes.strato_token,
          user: attributes.stratoSender || attributes.strato_sender,
          dest: attributes.externalRecipient || attributes.external_recipient,
          destChainId: attributes.externalChainId || attributes.external_chain_id,
          externalToken: attributes.representationToken || attributes.representation_token,
          externalTokenAmount: attributes.stratoTokenAmount || attributes.strato_token_amount || "0",
        },
      } as Event;

      return {
        ...activityTypes.Withdraw.handler(normalizedEvent, tokenSymbols, userAddress, tokenImages),
        title: "Native Bridge Out",
      };
    },
  },
  "CDPMint": {
    contract_name: "CDPEngine",
    event_name: "USDSTMinted",
    displayName: "CDP Mint",
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
    displayName: "Trade",
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
        title: "Trade",
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
    iconConfig: { icon: Plus, color: "bg-green-700" },
    getTokenAddress: (event: Event) => {
      // Token addresses aren't in the event, but we'll fetch them from the pool
      // Return empty array - pool tokens will be fetched separately in ActivityFeedCards
      return [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const provider = event.attributes.provider || event.attributes.Provider || "";
      let tokenAAmount = event.attributes.tokenAAmount || event.attributes.token_a_amount || event.attributes.tokenA || "0";
      let tokenBAmount = event.attributes.tokenBAmount || event.attributes.token_b_amount || event.attributes.tokenB || "0";

      // StablePool events use tokenAmounts[] instead of individual fields
      if ((!tokenAAmount || tokenAAmount === "0") && (!tokenBAmount || tokenBAmount === "0")) {
        const raw = event.attributes.tokenAmounts || event.attributes.token_amounts;
        if (raw) {
          try {
            const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (Array.isArray(arr) && arr.length >= 2) {
              tokenAAmount = String(arr[0]);
              tokenBAmount = String(arr[1]);
            }
          } catch { /* keep defaults */ }
        }
      }

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
  "V3Swap": {
    contract_name: "PoolV3",
    event_name: "Swap",
    displayName: "Trade (V3)",
    iconConfig: { icon: ArrowLeftRight, color: "bg-orange-500" },
    // token0/token1 aren't in the event — ActivityFeedCards resolves them from the
    // pool (event.address) and attaches them onto the event before this runs
    getTokenAddress: (event: Event) => {
      const e = event as Event & { token0?: string; token1?: string };
      return [e.token0, e.token1].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const e = event as Event & { token0?: string; token1?: string };
      const sender = getEventAttribute(event, "sender", "recipient");
      const toBigInt = (v: string): bigint => {
        try { return BigInt(v || "0"); } catch { return 0n; }
      };
      // amount0/amount1 are the pool's signed deltas: positive = paid to the pool
      // (the user's input side), negative = paid out by the pool (the output side)
      const amount0 = toBigInt(getEventAttribute(event, "amount0"));
      const amount1 = toBigInt(getEventAttribute(event, "amount1"));
      const zeroForOne = amount0 > 0n;
      const tokenIn = (zeroForOne ? e.token0 : e.token1) || "";
      const tokenOut = (zeroForOne ? e.token1 : e.token0) || "";
      const amountIn = (zeroForOne ? amount0 : amount1).toString();
      const amountOut = (-(zeroForOne ? amount1 : amount0)).toString();

      const fields: ActivityField[] = [
        {
          label: "Amount In",
          value: formatValue(amountIn, tokenIn),
          type: "amount",
          badge: tokenSymbols.get(tokenIn),
          image: tokenImages?.get(tokenIn),
          imageFallback: tokenSymbols.get(tokenIn) || tokenIn,
          rawAmount: getFullAmount(amountIn),
        },
        {
          label: "Amount Out",
          value: formatValue(amountOut, tokenOut),
          type: "amount",
          badge: tokenSymbols.get(tokenOut),
          image: tokenImages?.get(tokenOut),
          imageFallback: tokenSymbols.get(tokenOut) || tokenOut,
          rawAmount: getFullAmount(amountOut),
        },
        {
          label: "By",
          value: sender,
          type: "address",
          isUserAddress: isUserAddress(sender, userAddress),
        },
      ];

      return {
        title: "Trade (V3)",
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
  "V3AddLiquidity": {
    contract_name: "PoolV3",
    event_name: "Mint",
    displayName: "Add Liquidity (V3)",
    iconConfig: { icon: Plus, color: "bg-green-700" },
    getTokenAddress: (event: Event) => {
      const e = event as Event & { token0?: string; token1?: string };
      return [e.token0, e.token1].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const e = event as Event & { token0?: string; token1?: string };
      const provider = getEventAttribute(event, "owner", "sender");
      const amount0 = getEventAttribute(event, "amount0") || "0";
      const amount1 = getEventAttribute(event, "amount1") || "0";
      const token0 = e.token0 || "";
      const token1 = e.token1 || "";

      const fields: ActivityField[] = [
        {
          label: "Token A Amount",
          value: formatValue(amount0, token0),
          type: "amount",
          badge: tokenSymbols.get(token0),
          image: tokenImages?.get(token0),
          imageFallback: tokenSymbols.get(token0) || token0 || "Token 0",
          rawAmount: getFullAmount(amount0),
        },
        {
          label: "Token B Amount",
          value: formatValue(amount1, token1),
          type: "amount",
          badge: tokenSymbols.get(token1),
          image: tokenImages?.get(token1),
          imageFallback: tokenSymbols.get(token1) || token1 || "Token 1",
          rawAmount: getFullAmount(amount1),
        },
        {
          label: "Provider",
          value: provider,
          type: "address",
          isUserAddress: isUserAddress(provider, userAddress),
        },
      ];

      return {
        title: "Add Liquidity (V3)",
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
  "V3RemoveLiquidity": {
    contract_name: "PoolV3",
    event_name: "Burn",
    displayName: "Remove Liquidity (V3)",
    iconConfig: { icon: Minus, color: "bg-red-500" },
    getTokenAddress: (event: Event) => {
      const e = event as Event & { token0?: string; token1?: string };
      return [e.token0, e.token1].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData | null => {
      const e = event as Event & { token0?: string; token1?: string };
      // owner on pool-level Burn events; sender on PositionManagerV3 DecreaseLiquidity
      const owner = getEventAttribute(event, "owner", "sender");
      const amount0 = getEventAttribute(event, "amount0") || "0";
      const amount1 = getEventAttribute(event, "amount1") || "0";
      // a zero-amount burn is the fee-realizing poke that precedes a collect —
      // pure bookkeeping, not a user-visible removal
      if (amount0 === "0" && amount1 === "0") return null;
      const token0 = e.token0 || "";
      const token1 = e.token1 || "";

      const fields: ActivityField[] = [
        {
          label: "Token A Amount",
          value: formatValue(amount0, token0),
          type: "amount",
          badge: tokenSymbols.get(token0),
          image: tokenImages?.get(token0),
          imageFallback: tokenSymbols.get(token0) || token0 || "Token 0",
          rawAmount: getFullAmount(amount0),
        },
        {
          label: "Token B Amount",
          value: formatValue(amount1, token1),
          type: "amount",
          badge: tokenSymbols.get(token1),
          image: tokenImages?.get(token1),
          imageFallback: tokenSymbols.get(token1) || token1 || "Token 1",
          rawAmount: getFullAmount(amount1),
        },
        {
          label: "Provider",
          value: owner,
          type: "address",
          isUserAddress: isUserAddress(owner, userAddress),
        },
      ];

      return {
        title: "Remove Liquidity (V3)",
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
  "V3Collect": {
    contract_name: "PoolV3",
    event_name: "Collect",
    displayName: "Collect (V3)",
    iconConfig: { icon: Coins, color: "bg-amber-500" },
    getTokenAddress: (event: Event) => {
      const e = event as Event & { token0?: string; token1?: string };
      return [e.token0, e.token1].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData | null => {
      const e = event as Event & { token0?: string; token1?: string };
      const recipient = getEventAttribute(event, "recipient", "owner");
      const amount0 = getEventAttribute(event, "amount0") || "0";
      const amount1 = getEventAttribute(event, "amount1") || "0";
      // nothing was owed — no tokens moved, nothing to show
      if (amount0 === "0" && amount1 === "0") return null;
      const token0 = e.token0 || "";
      const token1 = e.token1 || "";

      const fields: ActivityField[] = [
        {
          label: "Token A Amount",
          value: formatValue(amount0, token0),
          type: "amount",
          badge: tokenSymbols.get(token0),
          image: tokenImages?.get(token0),
          imageFallback: tokenSymbols.get(token0) || token0 || "Token 0",
          rawAmount: getFullAmount(amount0),
        },
        {
          label: "Token B Amount",
          value: formatValue(amount1, token1),
          type: "amount",
          badge: tokenSymbols.get(token1),
          image: tokenImages?.get(token1),
          imageFallback: tokenSymbols.get(token1) || token1 || "Token 1",
          rawAmount: getFullAmount(amount1),
        },
        {
          label: "To",
          value: recipient,
          type: "address",
          isUserAddress: isUserAddress(recipient, userAddress),
        },
      ];

      return {
        title: "Collect (V3)",
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
            fieldLabels: ["To"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "RewardsClaimed": {
    contract_name: "Rewards",
    event_name: "RewardsClaimed",
    displayName: "Reward Points Claimed",
    iconConfig: { icon: Gift, color: "bg-emerald-500" },
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
        title: "Reward Points Claimed",
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
  "StratoStaked": {
    contract_name: "StratoStaking",
    event_name: "Staked",
    displayName: "STRATO Staked",
    iconConfig: { icon: ShieldCheck, color: "bg-cyan-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const user = getEventAttribute(event, "user", "User");
      const operator = getEventAttribute(event, "operator", "Operator");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";

      return {
        title: "STRATO Staked",
        fields: [
          stratoAmountField("Amount", amount),
          addressField("User", user, userAddress),
          addressField("Validator", operator, userAddress),
        ],
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: ["User", "Validator"], renderer: "addresses-with-bullet" },
        },
      };
    },
  },
  "StratoStakeMoved": {
    contract_name: "StratoStaking",
    event_name: "StakeMoved",
    displayName: "STRATO Stake Moved",
    iconConfig: { icon: ArrowLeftRight, color: "bg-cyan-600" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const user = getEventAttribute(event, "user", "User");
      const fromOperator = getEventAttribute(event, "fromOperator", "FromOperator");
      const toOperator = getEventAttribute(event, "toOperator", "ToOperator");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";

      return {
        title: "STRATO Stake Moved",
        fields: [
          stratoAmountField("Amount", amount),
          addressField("User", user, userAddress),
          addressField("From Validator", fromOperator, userAddress),
          addressField("To Validator", toOperator, userAddress),
        ],
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: ["User", "From Validator", "To Validator"] },
        },
      };
    },
  },
  "StratoUnbondingStarted": {
    contract_name: "StratoStaking",
    event_name: "UnbondingStarted",
    displayName: "STRATO Unstake Queued",
    iconConfig: { icon: Clock, color: "bg-cyan-400" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const user = getEventAttribute(event, "user", "User");
      const operator = getEventAttribute(event, "operator", "Operator");
      const requestId = getEventAttribute(event, "requestId", "RequestId");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";
      const releaseTime = formatUnixSeconds(getEventAttribute(event, "releaseTime", "ReleaseTime"));

      const fields: ActivityField[] = [
        stratoAmountField("Amount", amount),
        addressField("User", user, userAddress),
        addressField("Validator", operator, userAddress),
      ];
      if (requestId) fields.push({ label: "Request", value: `#${requestId}`, type: "text" });
      if (releaseTime) fields.push({ label: "Releases", value: releaseTime, type: "text" });

      return {
        title: "STRATO Unstake Queued",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: releaseTime ? ["User", "Validator", "Releases"] : ["User", "Validator"] },
        },
      };
    },
  },
  "StratoUnbondedWithdrawn": {
    contract_name: "StratoStaking",
    event_name: "UnbondedWithdrawn",
    displayName: "STRATO Withdrawn",
    iconConfig: { icon: Upload, color: "bg-cyan-700" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const user = getEventAttribute(event, "user", "User");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";

      return {
        title: "STRATO Withdrawn",
        fields: [
          stratoAmountField("Amount", amount),
          addressField("User", user, userAddress),
        ],
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: ["User"], renderer: "addresses-with-bullet" },
        },
      };
    },
  },
  "StratoDelegatorRewardsClaimed": {
    contract_name: "StratoStaking",
    event_name: "DelegatorRewardsClaimed",
    displayName: "STRATO Rewards Claimed",
    iconConfig: { icon: Gift, color: "bg-cyan-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const user = getEventAttribute(event, "user", "User");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";

      return {
        title: "STRATO Rewards Claimed",
        fields: [
          stratoAmountField("Amount", amount),
          addressField("User", user, userAddress),
        ],
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: ["User"], renderer: "addresses-with-bullet" },
        },
      };
    },
  },
  "StratoSelfBonded": {
    contract_name: "StratoStaking",
    event_name: "SelfBonded",
    displayName: "STRATO Self-Bonded",
    iconConfig: { icon: Coins, color: "bg-sky-600" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const operator = getEventAttribute(event, "operator", "Operator");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";

      return {
        title: "STRATO Self-Bonded",
        fields: [
          stratoAmountField("Amount", amount),
          addressField("Operator", operator, userAddress),
        ],
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: ["Operator"], renderer: "addresses-with-bullet" },
        },
      };
    },
  },
  "StratoSelfBondUnbondingStarted": {
    contract_name: "StratoStaking",
    event_name: "SelfBondUnbondingStarted",
    displayName: "STRATO Self-Bond Unstaking",
    iconConfig: { icon: Clock, color: "bg-sky-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const operator = getEventAttribute(event, "operator", "Operator");
      const requestId = getEventAttribute(event, "requestId", "RequestId");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";
      const releaseTime = formatUnixSeconds(getEventAttribute(event, "releaseTime", "ReleaseTime"));

      const fields: ActivityField[] = [
        stratoAmountField("Amount", amount),
        addressField("Operator", operator, userAddress),
      ];
      if (requestId) fields.push({ label: "Request", value: `#${requestId}`, type: "text" });
      if (releaseTime) fields.push({ label: "Releases", value: releaseTime, type: "text" });

      return {
        title: "STRATO Self-Bond Unstaking",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: releaseTime ? ["Operator", "Releases"] : ["Operator"] },
        },
      };
    },
  },
  "StratoDelegatorFeesClaimed": {
    contract_name: "StratoStaking",
    event_name: "DelegatorFeesClaimed",
    displayName: "Validator Fees Claimed",
    iconConfig: { icon: Gift, color: "bg-emerald-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const user = getEventAttribute(event, "user", "User");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";

      return {
        title: "Validator Fees Claimed",
        fields: [
          usdstFeeField("Amount", amount),
          addressField("User", user, userAddress),
        ],
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: ["User"], renderer: "addresses-with-bullet" },
        },
      };
    },
  },
  "StratoOperatorFeesClaimed": {
    contract_name: "StratoStaking",
    event_name: "OperatorFeesClaimed",
    displayName: "Operator Fees Claimed",
    iconConfig: { icon: Gift, color: "bg-emerald-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const operator = getEventAttribute(event, "operator", "Operator");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";

      return {
        title: "Operator Fees Claimed",
        fields: [
          usdstFeeField("Amount", amount),
          addressField("Operator", operator, userAddress),
        ],
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: ["Operator"], renderer: "addresses-with-bullet" },
        },
      };
    },
  },
  "StratoValidatorSynced": {
    contract_name: "StratoStaking",
    event_name: "ValidatorSynced",
    displayName: "Validator Set Updated",
    iconConfig: { icon: ShieldCheck, color: "bg-sky-600" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData =>
      stratoValidatorCard(
        "Validator Set Updated",
        event,
        userAddress,
        getEventAttribute(event, "registered", "Registered") === "true" ? "Joined the validator set" : "Left the validator set"
      ),
  },
  "StratoValidatorEvicted": {
    contract_name: "StratoStaking",
    event_name: "ValidatorEvicted",
    displayName: "Validator Evicted",
    iconConfig: { icon: Minus, color: "bg-amber-600" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData =>
      stratoValidatorCard("Validator Evicted", event, userAddress, "Outbid for a validator slot"),
  },
  "StratoValidatorJailed": {
    contract_name: "StratoStaking",
    event_name: "ValidatorJailed",
    displayName: "Validator Jailed",
    iconConfig: { icon: Clock, color: "bg-rose-600" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const until = formatUnixSeconds(getEventAttribute(event, "jailedUntil", "JailedUntil"));
      return stratoValidatorCard("Validator Jailed", event, userAddress, until ? `Missed proposals; jailed until ${until}` : "Missed proposals");
    },
  },
  "StratoExitRequested": {
    contract_name: "StratoStaking",
    event_name: "ExitRequested",
    displayName: "Validator Exit Requested",
    iconConfig: { icon: Clock, color: "bg-slate-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const ready = formatUnixSeconds(getEventAttribute(event, "readyTime", "ReadyTime"));
      return stratoValidatorCard("Validator Exit Requested", event, userAddress, ready ? `Leaves the set at ${ready}` : undefined);
    },
  },
  "StratoExitCancelled": {
    contract_name: "StratoStaking",
    event_name: "ExitCancelled",
    displayName: "Validator Exit Cancelled",
    iconConfig: { icon: CheckCircle, color: "bg-slate-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData =>
      stratoValidatorCard("Validator Exit Cancelled", event, userAddress),
  },
  "StratoOperatorRewardsClaimed": {
    contract_name: "StratoStaking",
    event_name: "OperatorRewardsClaimed",
    displayName: "STRATO Operator Rewards Claimed",
    iconConfig: { icon: Gift, color: "bg-sky-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null): ActivityCardData => {
      const operator = getEventAttribute(event, "operator", "Operator");
      const amount = getEventAttribute(event, "amount", "Amount") || "0";

      return {
        title: "STRATO Operator Rewards Claimed",
        fields: [
          stratoAmountField("Amount", amount),
          addressField("Operator", operator, userAddress),
        ],
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: { fieldLabels: ["Amount"], renderer: "amount-with-token" },
          line2: { fieldLabels: ["Operator"], renderer: "addresses-with-bullet" },
        },
      };
    },
  },
  "Borrow": {
    contract_name: "LendingPool",
    event_name: "Borrowed",
    displayName: "Borrow",
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
    displayName: "Lending Pool Deposit",
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
        title: "Lending Pool Deposit",
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
  "VaultDeposited": {
    contract_name: "Vault",
    event_name: "Deposited",
    displayName: "Diversified Vault Deposit",
    iconConfig: { icon: Download, color: "bg-teal-500" },
    getTokenAddress: (event: Event) => {
      const asset = event.attributes.asset || event.attributes.Asset;
      return asset ? [asset] : [];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const user = event.attributes.user || event.attributes.User || "";
      const asset = event.attributes.asset || event.attributes.Asset || "";
      const amountIn = event.attributes.amountIn || event.attributes.amount_in || "0";
      const depositValueUSD = event.attributes.depositValueUSD || event.attributes.deposit_value_usd || "0";
      const tokenSymbol = asset ? tokenSymbols.get(asset) : undefined;
      const tokenImage = asset ? tokenImages?.get(asset) : undefined;

      const fields: ActivityField[] = [
        {
          label: "Amount",
          value: formatValue(amountIn, asset),
          type: "amount",
          badge: tokenSymbol,
          image: tokenImage,
          imageFallback: tokenSymbol || asset,
          rawAmount: getFullAmount(amountIn),
        },
        {
          label: "Depositor",
          value: user,
          type: "address",
          isUserAddress: isUserAddress(user, userAddress),
        },
        {
          label: "USD Value",
          value: `$${formatValue(depositValueUSD, usdstAddress)}`,
          type: "text",
        },
      ];

      return {
        title: "Diversified Vault Deposit",
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
            fieldLabels: ["Depositor", "USD Value"],
          },
        },
      };
    },
  },
  "VaultWithdrawn": {
    contract_name: "Vault",
    event_name: "Withdrawn",
    displayName: "Diversified Vault Withdrawal",
    iconConfig: { icon: Upload, color: "bg-amber-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const user = event.attributes.user || event.attributes.User || "";
      const sharesBurned = event.attributes.sharesBurned || event.attributes.shares_burned || "0";
      const withdrawValueUSD = event.attributes.withdrawValueUSD || event.attributes.withdraw_value_usd || "0";

      const fields: ActivityField[] = [
        {
          label: "USD Value",
          value: `$${formatValue(withdrawValueUSD, usdstAddress)}`,
          type: "amount",
          badge: "USD",
          rawAmount: `$${getFullAmount(withdrawValueUSD)}`,
        },
        {
          label: "Withdrawer",
          value: user,
          type: "address",
          isUserAddress: isUserAddress(user, userAddress),
        },
        {
          label: "Shares Burned",
          value: formatValue(sharesBurned),
          type: "text",
          badge: "shares",
        },
      ];

      return {
        title: "Diversified Vault Withdrawal",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["USD Value"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Withdrawer", "Shares Burned"],
          },
        },
      };
    },
  },
  "VaultWithdrawalPayout": {
    contract_name: "Vault",
    event_name: "WithdrawalPayout",
    displayName: "Diversified Vault Payout",
    iconConfig: { icon: Banknote, color: "bg-yellow-500" },
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
          label: "Recipient",
          value: user,
          type: "address",
          isUserAddress: isUserAddress(user, userAddress),
        },
      ];

      return {
        title: "Diversified Vault Payout",
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
            fieldLabels: ["Recipient"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "MetalMinted": {
    contract_name: "MetalForge",
    event_name: "MetalMinted",
    displayName: "Metal Mint",
    iconConfig: { icon: Gem, color: "bg-yellow-600" },
    getTokenAddress: (event: Event) => {
      const metalToken = event.attributes.metalToken || event.attributes.metal_token;
      const payToken = event.attributes.payToken || event.attributes.pay_token;
      return [metalToken, payToken].filter(Boolean) as string[];
    },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const buyer = event.attributes.buyer || event.attributes.Buyer || "";
      const metalToken = event.attributes.metalToken || event.attributes.metal_token || "";
      const payToken = event.attributes.payToken || event.attributes.pay_token || "";
      const payAmount = event.attributes.payAmount || event.attributes.pay_amount || "0";
      const metalAmount = event.attributes.metalAmount || event.attributes.metal_amount || "0";

      const metalSymbol = metalToken ? tokenSymbols.get(metalToken) : undefined;
      const paySymbol = payToken ? tokenSymbols.get(payToken) : undefined;
      const metalImage = metalToken ? tokenImages?.get(metalToken) : undefined;
      const payImage = payToken ? tokenImages?.get(payToken) : undefined;

      const fields: ActivityField[] = [
        {
          label: "Paid",
          value: formatValue(payAmount, payToken),
          type: "amount",
          badge: paySymbol,
          image: payImage,
          imageFallback: paySymbol || payToken,
          rawAmount: getFullAmount(payAmount),
        },
        {
          label: "Received",
          value: formatValue(metalAmount, metalToken),
          type: "amount",
          badge: metalSymbol,
          image: metalImage,
          imageFallback: metalSymbol || metalToken,
          rawAmount: getFullAmount(metalAmount),
        },
        {
          label: "Buyer",
          value: buyer,
          type: "address",
          isUserAddress: isUserAddress(buyer, userAddress),
        },
      ];

      return {
        title: "Metal Mint",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Paid", "Received"],
            renderer: "amounts-with-arrow",
          },
          line2: {
            fieldLabels: ["Buyer"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "YieldVaultDeposit": {
    contract_name: "YieldVault",
    event_name: "Deposit",
    displayName: "YieldVault Deposit",
    iconConfig: { icon: Download, color: "bg-cyan-500" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const assets = event.attributes.assets || event.attributes.Assets || "0";
      const shares = event.attributes.shares || event.attributes.Shares || "0";

      const fields: ActivityField[] = [
        {
          label: "Deposited",
          value: formatValue(assets),
          type: "amount",
          badge: tokenSymbols.get(event.address) || "assets",
          rawAmount: getFullAmount(assets),
        },
        {
          label: "Shares Minted",
          value: formatValue(shares),
          type: "text",
          badge: "shares",
        },
        {
          label: "Depositor",
          value: owner,
          type: "address",
          isUserAddress: isUserAddress(owner, userAddress),
        },
      ];

      return {
        title: "YieldVault Deposit",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Deposited"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Depositor", "Shares Minted"],
          },
        },
      };
    },
  },
  "YieldVaultWithdraw": {
    contract_name: "YieldVault",
    event_name: "Withdraw",
    displayName: "YieldVault Withdraw",
    iconConfig: { icon: Upload, color: "bg-cyan-600" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const receiver = event.attributes.receiver || event.attributes.Receiver || "";
      const assets = event.attributes.assets || event.attributes.Assets || "0";
      const shares = event.attributes.shares || event.attributes.Shares || "0";

      const fields: ActivityField[] = [
        {
          label: "Withdrawn",
          value: formatValue(assets),
          type: "amount",
          badge: tokenSymbols.get(event.address) || "assets",
          rawAmount: getFullAmount(assets),
        },
        {
          label: "Owner",
          value: owner,
          type: "address",
          isUserAddress: isUserAddress(owner, userAddress),
        },
        {
          label: "Receiver",
          value: receiver,
          type: "address",
          isUserAddress: isUserAddress(receiver, userAddress),
        },
      ];

      return {
        title: "YieldVault Withdraw",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Withdrawn"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Owner", "Receiver"],
            renderer: "addresses-with-arrow",
          },
        },
      };
    },
  },
  "YieldVaultWithdrawalRequested": {
    contract_name: "YieldVault",
    event_name: "WithdrawalRequested",
    displayName: "YieldVault Withdrawal Requested",
    iconConfig: { icon: Clock, color: "bg-cyan-400" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const receiver = event.attributes.receiver || event.attributes.Receiver || "";
      const shares = event.attributes.shares || event.attributes.Shares || "0";
      const requestId = event.attributes.requestId || event.attributes.request_id || "";

      const fields: ActivityField[] = [
        {
          label: "Shares Queued",
          value: formatValue(shares),
          type: "amount",
          badge: "shares",
          rawAmount: getFullAmount(shares),
        },
        {
          label: "Owner",
          value: owner,
          type: "address",
          isUserAddress: isUserAddress(owner, userAddress),
        },
        {
          label: "Receiver",
          value: receiver,
          type: "address",
          isUserAddress: isUserAddress(receiver, userAddress),
        },
        requestId ? {
          label: "Request",
          value: `#${requestId}`,
          type: "text",
          size: "xs",
        } : null,
      ].filter(Boolean) as ActivityField[];

      return {
        title: "YieldVault Withdrawal Requested",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Shares Queued"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: requestId ? ["Owner", "Request"] : ["Owner"],
            renderer: "addresses-with-bullet",
          },
        },
      };
    },
  },
  "YieldVaultClaimed": {
    contract_name: "YieldVault",
    event_name: "WithdrawalClaimed",
    displayName: "YieldVault Claimed",
    iconConfig: { icon: CheckCircle, color: "bg-cyan-700" },
    handler: (event: Event, tokenSymbols: Map<string, string>, userAddress?: string | null, tokenImages?: Map<string, string>): ActivityCardData => {
      const owner = event.attributes.owner || event.attributes.Owner || "";
      const receiver = event.attributes.receiver || event.attributes.Receiver || "";
      const assets = event.attributes.assets || event.attributes.Assets || "0";

      const fields: ActivityField[] = [
        {
          label: "Claimed",
          value: formatValue(assets),
          type: "amount",
          badge: tokenSymbols.get(event.address) || "assets",
          rawAmount: getFullAmount(assets),
        },
        {
          label: "Owner",
          value: owner,
          type: "address",
          isUserAddress: isUserAddress(owner, userAddress),
        },
        {
          label: "Receiver",
          value: receiver,
          type: "address",
          isUserAddress: isUserAddress(receiver, userAddress),
        },
      ];

      return {
        title: "YieldVault Claimed",
        fields,
        timestamp: event.block_timestamp || "",
        eventId: event.id?.toString(),
        layout: {
          type: "two-line",
          line1: {
            fieldLabels: ["Claimed"],
            renderer: "amount-with-token",
          },
          line2: {
            fieldLabels: ["Owner", "Receiver"],
            renderer: "addresses-with-arrow",
          },
        },
      };
    },
  },
};

// Position-NFT liquidity activity: actions done through PositionManagerV3. At the POOL
// level these all attribute to the manager (the backend's filter configs exclude those
// rows); the manager's platform-extended events carry the acting user (`sender`), the
// pool address (`pool` — ActivityFeedCards resolves token0/token1 from it), and the same
// amount fields, so the pool-level renderers apply as-is.
activityTypes["V3AddLiquidityPosition"] = {
  ...activityTypes["V3AddLiquidity"],
  contract_name: "PositionManagerV3",
  event_name: "IncreaseLiquidity",
};
activityTypes["V3RemoveLiquidityPosition"] = {
  ...activityTypes["V3RemoveLiquidity"],
  contract_name: "PositionManagerV3",
  event_name: "DecreaseLiquidity",
};
activityTypes["V3CollectPosition"] = {
  ...activityTypes["V3Collect"],
  contract_name: "PositionManagerV3",
  event_name: "Collect",
};
