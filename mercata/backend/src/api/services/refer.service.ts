import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { escrow } from "../../config/config";
import { extractContractName } from "../../utils/utils";
import { TransactionResponse } from "@mercata/shared-types";
import JSONBig from "json-bigint";

const { Token } = constants;
const Escrow = "storage";
const EscrowDeposits = `mapping`;
const JSONbigString = JSONBig({ storeAsString: true });

const normalizeArrayLike = (value: any): string[] => {
  if (typeof value === "string") {
    try {
      value = JSONbigString.parse(value);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.map(String);
  if (!value || typeof value !== "object") return [];
  return Object.keys(value)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => String(value[key]));
};

export interface DepositParams {
  tokens: string[]; // Array of token addresses (with or without 0x)
  amounts: string[]; // Array of amounts in wei (as strings)
  ephemeralAddress: string; // Ephemeral address (with or without 0x)
  expiry: number; // Expiry in seconds from now
  quantity: number; // Number of referrals this deposit supports
}

export const depositToEscrow = async (
  accessToken: string,
  userAddress: string,
  params: DepositParams
): Promise<TransactionResponse> => {
  // Normalize addresses (remove 0x prefix if present, convert to lowercase)
  const normalizeAddress = (addr: string): string => {
    return addr.startsWith("0x") ? addr.slice(2).toLowerCase() : addr.toLowerCase();
  };

  const ephemeralAddress = normalizeAddress(params.ephemeralAddress);
  const escrowAddress = normalizeAddress(escrow);

  // Validate ephemeral address
  if (!/^[0-9a-f]{40}$/.test(ephemeralAddress)) {
    throw new Error("Invalid ephemeral address");
  }
  if (!/^[0-9a-f]{40}$/.test(escrowAddress)) {
    throw new Error("Invalid escrow contract address");
  }

  // Normalize and validate all token addresses
  const normalizedTokens = params.tokens.map(token => normalizeAddress(token));
  for (const token of normalizedTokens) {
    if (!/^[0-9a-f]{40}$/.test(token)) {
      throw new Error(`Invalid token address: ${token}`);
    }
  }

  // Validate all amounts
  for (const amount of params.amounts) {
    if (!amount || BigInt(amount) <= 0n) {
      throw new Error("Invalid amount");
    }
  }

  // Validate expiry
  if (typeof params.expiry !== "number" || params.expiry <= 0) {
    throw new Error("Invalid expiry: must be a positive number of seconds");
  }

  // Validate quantity
  if (typeof params.quantity !== "number" || params.quantity <= 0 || !Number.isInteger(params.quantity)) {
    throw new Error("Invalid quantity: must be a positive integer");
  }

  // Build transaction: approve each token, then deposit all
  // Note: approve amount needs to be quantity * amount for each token
  const approveTxs = normalizedTokens.map((tokenAddress, index) => {
    const totalAmount = BigInt(params.amounts[index]) * BigInt(params.quantity);
    return {
      contractName: extractContractName(Token),
      contractAddress: tokenAddress,
      method: "approve",
      args: {
        spender: escrowAddress,
        value: totalAmount.toString(),
      },
    };
  });

  const depositTx = {
    contractName: Escrow,
    contractAddress: escrowAddress,
    method: "deposit",
    args: {
      tokens: normalizedTokens,
      amounts: params.amounts,
      ephemeralAddress: ephemeralAddress,
      expiry: params.expiry,
      quantity: params.quantity,
    },
  };

  const tx = await buildFunctionTx(
    [...approveTxs, depositTx],
    userAddress,
    accessToken
  );

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
};

export interface EscrowDepositQuery {
  ephemeralAddress: string; // without 0x prefix
}

export interface EscrowDepositResult {
  sender: string;
  tokens: string[];
  amounts: string[];
  expiry: number;
  quantity: number;
}

export const getEscrowDeposit = async (
  accessToken: string,
  query: EscrowDepositQuery
): Promise<EscrowDepositResult | null> => {
  // Normalize addresses
  const normalizeAddress = (addr: string): string => {
    return addr.startsWith("0x") ? addr.slice(2).toLowerCase() : addr.toLowerCase();
  };

  const ephemeralAddress = normalizeAddress(query.ephemeralAddress);
  const escrowAddress = normalizeAddress(escrow);

  // Validate addresses
  if (!/^[0-9a-f]{40}$/.test(ephemeralAddress)) {
    throw new Error("Invalid ephemeral address");
  }
  if (!/^[0-9a-f]{40}$/.test(escrowAddress)) {
    throw new Error("Invalid escrow contract address");
  }

  try {
    // Build query params
    const params: Record<string, string> = {
      select: "key,value",
      ['key->>key']: `eq.${ephemeralAddress}`,
      address: `eq.${escrowAddress}`,
      collection_name: `eq.deposits`,
    };

    // Query Cirrus for the deposit(s)
    const response = await cirrus.get(accessToken, `/${EscrowDeposits}`, {
      params,
    });

    const data = response.data;
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    // Return the first deposit found
    const deposit = data[0];
    return {
      sender: deposit.value?.sender || "",
      tokens: deposit.value?.tokens || [],
      amounts: deposit.value?.amounts || [],
      expiry: deposit.value?.expiry || 0,
      quantity: deposit.value?.quantity || 1,
    };
  } catch (error: any) {
    // If it's a 404 or empty result, return null
    if (error.response?.status === 404 || error.response?.status === 200) {
      return null;
    }
    throw error;
  }
};

export interface RedeemParams {
  r: string; // r component of signature (hex string)
  s: string; // s component of signature (hex string)
  v: number; // v component of signature (recovery id)
  recipient: string; // Recipient address (with or without 0x)
}

export const redeemEscrow = async (
  accessToken: string,
  params: RedeemParams,
  redemptionServerUrl: string
): Promise<any> => {
  // Validate signature components
  if (!params.r || typeof params.r !== "string") {
    throw new Error("r is required");
  }
  if (!params.s || typeof params.s !== "string") {
    throw new Error("s is required");
  }
  if (typeof params.v !== "number" || (params.v !== 27 && params.v !== 28)) {
    throw new Error("v must be 27 or 28");
  }
  if (!params.recipient) {
    throw new Error("recipient is required");
  }

  try {
    // Call redemption server with signature data
    const response = await fetch(`${redemptionServerUrl}/redeem-referral`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify({ 
        recipient: params.recipient,
        r: params.r,
        s: params.s,
        v: params.v,
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Redemption server error: ${response.status} ${text}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Error in redeemEscrow service:", error);
    throw error;
  }
};

export interface UserReferral {
  ephemeralAddress: string;
  sender: string;
  tokens: string[];
  amounts: string[];
  expiry: number;
  quantity: number;
}

export const getUserReferrals = async (
  accessToken: string,
  userAddress: string
): Promise<UserReferral[]> => {
  const normalizeAddress = (addr: string): string => {
    return addr.startsWith("0x") ? addr.slice(2).toLowerCase() : addr.toLowerCase();
  };

  const normalizedUserAddress = normalizeAddress(userAddress);
  const escrowAddress = normalizeAddress(escrow);

  if (!/^[0-9a-f]{40}$/.test(normalizedUserAddress)) {
    throw new Error("Invalid user address");
  }
  if (!/^[0-9a-f]{40}$/.test(escrowAddress)) {
    throw new Error("Invalid escrow contract address");
  }

  try {
    const params: Record<string, string> = {
      select: "key,value",
      address: `eq.${escrowAddress}`,
      collection_name: `eq.deposits`,
      ['value->>sender']: `eq.${normalizedUserAddress}`,
    };

    const response = await cirrus.get(accessToken, `/${EscrowDeposits}`, {
      params,
    });

    const data = response.data;
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }

    return data.map((deposit) => ({
      ephemeralAddress: deposit.key.key || "",
      sender: deposit.value?.sender || "",
      tokens: normalizeArrayLike(deposit.value?.tokens),
      amounts: normalizeArrayLike(deposit.value?.amounts),
      expiry: deposit.value?.expiry || 0,
      quantity: deposit.value?.quantity || 1,
    })).filter((deposit) => deposit.tokens.length > 0);
  } catch (error: any) {
    if (error.response?.status === 404 || error.response?.status === 200) {
      return [];
    }
    throw error;
  }
};

export interface CancelDepositParams {
  ephemeralAddress: string; // without 0x prefix
}

export const cancelDeposit = async (
  accessToken: string,
  userAddress: string,
  params: CancelDepositParams
): Promise<TransactionResponse> => {
  const normalizeAddress = (addr: string): string => {
    return addr.startsWith("0x") ? addr.slice(2).toLowerCase() : addr.toLowerCase();
  };

  const ephemeralAddress = normalizeAddress(params.ephemeralAddress);
  const escrowAddress = normalizeAddress(escrow);

  if (!/^[0-9a-f]{40}$/.test(ephemeralAddress)) {
    throw new Error("Invalid ephemeral address");
  }
  if (!/^[0-9a-f]{40}$/.test(escrowAddress)) {
    throw new Error("Invalid escrow contract address");
  }

  const cancelTx = {
    contractName: Escrow,
    contractAddress: escrowAddress,
    method: "cancelDeposit",
    args: {
      ephemeralAddress: ephemeralAddress,
    },
  };

  const tx = await buildFunctionTx(
    [cancelTx],
    userAddress,
    accessToken
  );

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
};

export interface ReferralHistoryEntry {
  id: string;
  eventName: string;
  ephemeralAddress: string;
  tokens: string[];
  amounts: string[];
  sender: string;
  recipient?: string; // Only for Redeemed events
  blockTimestamp: Date;
  quantity?: number; // Quantity from event attributes (for Cancelled events)
}

export interface ReferralStatusResult {
  status: 'active' | 'redeemed' | 'cancelled' | 'user_redeemed';
  eventName?: string;
  blockTimestamp?: Date;
}

export const getReferralStatus = async (
  accessToken: string,
  ephemeralAddress: string,
  userAddress?: string
): Promise<ReferralStatusResult> => {
  const normalizeAddress = (addr: string): string => {
    return addr.startsWith("0x") ? addr.slice(2).toLowerCase() : addr.toLowerCase();
  };

  const normalizedEphemeralAddress = normalizeAddress(ephemeralAddress);
  const escrowAddress = normalizeAddress(escrow);

  if (!/^[0-9a-f]{40}$/.test(normalizedEphemeralAddress)) {
    throw new Error("Invalid ephemeral address");
  }
  if (!/^[0-9a-f]{40}$/.test(escrowAddress)) {
    throw new Error("Invalid escrow contract address");
  }

  try {
    // First, check for Cancelled event (takes precedence)
    const cancelledParams: Record<string, string> = {
      select: "event_name,attributes,block_timestamp",
      address: `eq.${escrowAddress}`,
      event_name: `eq.Cancelled`,
      ['attributes->>ephemeralAddress']: `eq.${normalizedEphemeralAddress}`,
      order: "block_timestamp.desc",
      limit: "1",
    };

    const cancelledResponse = await cirrus.get(accessToken, `/event`, {
      params: cancelledParams,
    });

    if (Array.isArray(cancelledResponse.data) && cancelledResponse.data.length > 0) {
      const event = cancelledResponse.data[0];
      return {
        status: 'cancelled',
        eventName: event.event_name,
        blockTimestamp: event.block_timestamp ? new Date(event.block_timestamp) : undefined,
      };
    }

    // Check if current user has redeemed
    if (userAddress) {
      const normalizedUserAddress = normalizeAddress(userAddress);
      const userRedeemedParams: Record<string, string> = {
        select: "event_name,attributes,block_timestamp",
        address: `eq.${escrowAddress}`,
        event_name: `eq.Redeemed`,
        ['attributes->>ephemeralAddress']: `eq.${normalizedEphemeralAddress}`,
        ['attributes->>recipient']: `eq.${normalizedUserAddress}`,
        order: "block_timestamp.desc",
        limit: "1",
      };

      const userRedeemedResponse = await cirrus.get(accessToken, `/event`, {
        params: userRedeemedParams,
      });

      if (Array.isArray(userRedeemedResponse.data) && userRedeemedResponse.data.length > 0) {
        return {
          status: 'user_redeemed',
          eventName: 'Redeemed',
          blockTimestamp: userRedeemedResponse.data[0].block_timestamp 
            ? new Date(userRedeemedResponse.data[0].block_timestamp) 
            : undefined,
        };
      }
    }

    // Check deposit to see if there's still available quantity
    const depositParams: Record<string, string> = {
      select: "key,value",
      ['key->>key']: `eq.${normalizedEphemeralAddress}`,
      address: `eq.${escrowAddress}`,
      collection_name: `eq.deposits`,
    };

    const depositResponse = await cirrus.get(accessToken, `/${EscrowDeposits}`, {
      params: depositParams,
    });

    const depositData = depositResponse.data;
    if (Array.isArray(depositData) && depositData.length > 0) {
      const deposit = depositData[0];
      const quantity = deposit.value?.quantity || 0;
      
      // If quantity is 0, it's fully redeemed
      if (quantity === 0 || quantity === '0000000000000000000000000000000000000000') {
        return { status: 'redeemed' };
      }
      
      // If quantity > 0, it's still active
      return { status: 'active' };
    }

    // No deposit found, check if there are any Redeemed events (might be fully redeemed)
    const redeemedParams: Record<string, string> = {
      select: "event_name,attributes,block_timestamp",
      address: `eq.${escrowAddress}`,
      event_name: `eq.Redeemed`,
      ['attributes->>ephemeralAddress']: `eq.${normalizedEphemeralAddress}`,
      order: "block_timestamp.desc",
      limit: "1",
    };

    const redeemedResponse = await cirrus.get(accessToken, `/event`, {
      params: redeemedParams,
    });

    if (Array.isArray(redeemedResponse.data) && redeemedResponse.data.length > 0) {
      // There's a Redeemed event but no deposit, so it's fully redeemed
      return {
        status: 'redeemed',
        eventName: 'Redeemed',
        blockTimestamp: redeemedResponse.data[0].block_timestamp 
          ? new Date(redeemedResponse.data[0].block_timestamp) 
          : undefined,
      };
    }

    // No events and no deposit, assume active
    return { status: 'active' };
  } catch (error: any) {
    if (error.response?.status === 404 || error.response?.status === 200) {
      return { status: 'active' };
    }
    throw error;
  }
};

export const getReferralHistory = async (
  accessToken: string,
  userAddress: string
): Promise<ReferralHistoryEntry[]> => {
  const normalizeAddress = (addr: string): string => {
    return addr.startsWith("0x") ? addr.slice(2).toLowerCase() : addr.toLowerCase();
  };

  const normalizedUserAddress = normalizeAddress(userAddress);
  const escrowAddress = normalizeAddress(escrow);

  if (!/^[0-9a-f]{40}$/.test(normalizedUserAddress)) {
    throw new Error("Invalid user address");
  }
  if (!/^[0-9a-f]{40}$/.test(escrowAddress)) {
    throw new Error(`Invalid escrow contract address: ${escrowAddress}`);
  }

  try {
    const params: Record<string, string> = {
      select: "id,event_name,attributes,block_timestamp",
      address: `eq.${escrowAddress}`,
      event_name: `in.(Redeemed,Cancelled)`,
      ['attributes->>sender']: `eq.${normalizedUserAddress}`,
      order: "block_timestamp.desc",
    };

    const response = await cirrus.get(accessToken, `/event`, {
      params,
    });

    const data = response.data;
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }

    return data.map((event: any) => {
      // Handle attributes that might be a JSON string or an object
      const attributes = typeof event.attributes === 'string' 
        ? JSON.parse(event.attributes) 
        : event.attributes || {};

      return {
        id: event.id?.toString() || "",
        eventName: event.event_name || "",
        ephemeralAddress: attributes.ephemeralAddress || "",
        tokens: normalizeArrayLike(attributes.tokens),
        amounts: normalizeArrayLike(attributes.amounts),
        sender: attributes.sender || "",
        recipient: attributes.recipient || undefined,
        blockTimestamp: event.block_timestamp ? new Date(event.block_timestamp) : new Date(),
        quantity: attributes.quantity ? Number(attributes.quantity) : undefined,
      };
    });
  } catch (error: any) {
    if (error.response?.status === 404 || error.response?.status === 200) {
      return [];
    }
    throw error;
  }
};

