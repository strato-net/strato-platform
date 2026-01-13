import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { TransactionResponse } from "@mercata/shared-types";

const { Token, escrow } = constants;
const Escrow = "storage";
const EscrowDeposits = `mapping`;

export interface DepositParams {
  tokens: string[]; // Array of token addresses (with or without 0x)
  amounts: string[]; // Array of amounts in wei (as strings)
  ephemeralAddress: string; // Ephemeral address (with or without 0x)
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

  // Build transaction: approve each token, then deposit all
  const approveTxs = normalizedTokens.map((tokenAddress, index) => ({
    contractName: extractContractName(Token),
    contractAddress: tokenAddress,
    method: "approve",
    args: {
      spender: escrowAddress,
      value: params.amounts[index],
    },
  }));

  const depositTx = {
    contractName: Escrow,
    contractAddress: escrowAddress,
    method: "deposit",
    args: {
      tokens: normalizedTokens,
      amounts: params.amounts,
      ephemeralAddress: ephemeralAddress,
      expiry: 0,
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
      expiry: deposit.value?.expirty || 0,
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

