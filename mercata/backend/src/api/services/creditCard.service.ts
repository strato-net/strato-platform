import axios from "axios";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import type { CreditCardConfig, CreditCardTopUpExecuteParams } from "@mercata/shared-types";
import type { TransactionResponse } from "@mercata/shared-types";

const { CreditCardTopUp, creditCardTopUp, Token, USDST } = constants;

/** ERC20 balanceOf selector */
const BALANCE_OF_SELECTOR = "0x70a08231";

function getExternalChainRpcUrls(): Record<string, string> {
  const raw = process.env.EXTERNAL_CHAIN_RPC_URLS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Fetch ERC20 balance on an external chain via JSON-RPC eth_call.
 */
export async function getErc20Balance(
  rpcUrl: string,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const addr = walletAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const data = BALANCE_OF_SELECTOR + addr;
  const res = await axios.post(
    rpcUrl,
    {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: tokenAddress.startsWith("0x") ? tokenAddress : `0x${tokenAddress}`, data }, "latest"],
      id: 1,
    },
    { timeout: 10_000 }
  );
  const result = res.data?.result;
  if (typeof result !== "string" || !result) return 0n;
  return BigInt(result);
}

/** In-memory store: user address -> list of card configs. Production should use a persistent store. */
const configStore = new Map<string, CreditCardConfig[]>();

function normalizeAddress(addr: string): string {
  return addr?.toLowerCase().replace(/^0x/, "") ?? "";
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function getConfigs(userAddress: string): CreditCardConfig[] {
  const key = normalizeAddress(userAddress);
  return configStore.get(key) ?? [];
}

export function getConfigById(userAddress: string, id: string): CreditCardConfig | null {
  const list = getConfigs(userAddress);
  return list.find((c) => c.id === id) ?? null;
}

/**
 * Card row from Cirrus userCards table (value may be struct with nickname, providerId, etc.).
 */
export type CardRowFromCirrus = {
  key2?: number;
  value?: {
    nickname?: string;
    providerId?: string;
    destinationChainId?: string | number;
    externalToken?: string;
    cardWalletAddress?: string;
  };
};

/**
 * Get a user's cards from Cirrus (CreditCardTopUp-userCards table). No RPC/eth_call.
 */
export async function getCardsFromCirrus(
  accessToken: string,
  userAddress: string
): Promise<Array<{ id: string; nickname?: string; providerId?: string; destinationChainId: string; externalToken: string; cardWalletAddress: string }>> {
  if (!creditCardTopUp) {
    return [];
  }
  const normalizedUser = normalizeAddress(userAddress);
  try {
    const { data } = await cirrus.get(accessToken, `/${CreditCardTopUp}-userCards`, {
      params: {
        select: "key2,value",
        address: `eq.${creditCardTopUp}`,
        key: `eq.${normalizedUser}`,
        order: "key2.asc",
      },
    });
    if (!Array.isArray(data)) return [];
    return data.map((row: CardRowFromCirrus, i: number) => {
      const v = row?.value ?? {};
      return {
        id: String(row?.key2 ?? i),
        nickname: typeof v.nickname === "string" ? v.nickname : undefined,
        providerId: typeof v.providerId === "string" ? v.providerId : undefined,
        destinationChainId: String(v.destinationChainId ?? "0"),
        externalToken: typeof v.externalToken === "string" ? v.externalToken : "",
        cardWalletAddress: typeof v.cardWalletAddress === "string" ? v.cardWalletAddress : "",
      };
    });
  } catch (err) {
    console.error("getCardsFromCirrus:", err);
    return [];
  }
}

function sameCard(a: CreditCardConfig, b: { destinationChainId: string; externalToken: string; cardWalletAddress: string }): boolean {
  return (
    a.destinationChainId === b.destinationChainId &&
    a.externalToken === b.externalToken &&
    normalizeAddress(a.cardWalletAddress) === normalizeAddress(b.cardWalletAddress)
  );
}

export function upsertConfig(
  userAddress: string,
  body: Omit<CreditCardConfig, "userAddress"> & { id?: string }
): CreditCardConfig {
  const key = normalizeAddress(userAddress);
  let list = configStore.get(key) ?? [];
  const existingIndex = body.id ? list.findIndex((c) => c.id === body.id) : -1;
  if (existingIndex < 0) {
    const duplicate = list.find((c) => sameCard(c, body));
    if (duplicate) {
      throw new Error("This card is already connected.");
    }
  }
  const id = existingIndex >= 0 ? list[existingIndex].id : generateId();
  const full: CreditCardConfig = {
    ...body,
    id,
    userAddress,
  };
  if (existingIndex >= 0) {
    list = [...list];
    list[existingIndex] = full;
  } else {
    list = [...list, full];
  }
  configStore.set(key, list);
  return full;
}

export function deleteConfig(userAddress: string, id: string): boolean {
  const key = normalizeAddress(userAddress);
  const list = configStore.get(key) ?? [];
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  configStore.set(key, next);
  return true;
}

/** Returns all enabled configs for the balance watcher (all users). */
export function getConfigsForWatcher(): CreditCardConfig[] {
  return Array.from(configStore.values()).flat().filter((c) => c.enabled);
}

/**
 * Execute a single top-up by calling CreditCardTopUp.topUpCard as the operator.
 * Must be called with an operator access token (e.g. from env OPERATOR_ACCESS_TOKEN).
 * Contract address must be set in config (CREDIT_CARD_TOP_UP_ADDRESS).
 */
export async function executeTopUp(
  operatorAccessToken: string,
  params: CreditCardTopUpExecuteParams
): Promise<TransactionResponse> {
  if (!creditCardTopUp) {
    throw new Error("CREDIT_CARD_TOP_UP_ADDRESS is not configured");
  }
  const tx = await buildFunctionTx(
    [
      {
        contractName: extractContractName(CreditCardTopUp),
        contractAddress: creditCardTopUp,
        method: "topUpCard",
        args: {
          user: params.userAddress,
          stratoTokenAmount: params.stratoTokenAmount,
          externalChainId: params.externalChainId,
          externalRecipient: params.externalRecipient,
          externalToken: params.externalToken,
        },
      },
    ],
    undefined,
    undefined
  );
  return await postAndWaitForTx(operatorAccessToken, () =>
    strato.post(operatorAccessToken, StratoPaths.transactionParallel, tx)
  );
}

/**
 * Submit addCard transaction to STRATO via POST /strato/v2.3/transaction/parallel.
 * Called by the app when the user adds a card (no MetaMask tx).
 */
export async function submitAddCard(
  accessToken: string,
  userAddress: string,
  body: {
    nickname: string;
    providerId: string;
    destinationChainId: string;
    externalToken: string;
    cardWalletAddress: string;
  }
): Promise<{ status: string; hash: string }> {
  if (!creditCardTopUp) {
    throw new Error("CREDIT_CARD_TOP_UP_ADDRESS is not configured");
  }
  const externalToken = (body.externalToken || "").replace(/^0x/i, "").toLowerCase();
  const cardWalletAddress = (body.cardWalletAddress || "").replace(/^0x/i, "").toLowerCase();
  if (!externalToken || !cardWalletAddress) {
    throw new Error("externalToken and cardWalletAddress are required");
  }
  const tx = await buildFunctionTx(
    {
      contractName: extractContractName(CreditCardTopUp),
      contractAddress: creditCardTopUp,
      method: "addCard",
      args: {
        nickname: body.nickname || "",
        providerId: body.providerId || "",
        destinationChainId: body.destinationChainId,
        externalToken,
        cardWalletAddress,
      },
    },
    userAddress,
    accessToken
  );
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
}

/**
 * Submit updateCard transaction to STRATO.
 */
export async function submitUpdateCard(
  accessToken: string,
  userAddress: string,
  body: {
    index: number;
    nickname: string;
    providerId: string;
    destinationChainId: string;
    externalToken: string;
    cardWalletAddress: string;
  }
): Promise<{ status: string; hash: string }> {
  if (!creditCardTopUp) {
    throw new Error("CREDIT_CARD_TOP_UP_ADDRESS is not configured");
  }
  const externalToken = (body.externalToken || "").replace(/^0x/i, "").toLowerCase();
  const cardWalletAddress = (body.cardWalletAddress || "").replace(/^0x/i, "").toLowerCase();
  if (!externalToken || !cardWalletAddress) {
    throw new Error("externalToken and cardWalletAddress are required");
  }
  const tx = await buildFunctionTx(
    {
      contractName: extractContractName(CreditCardTopUp),
      contractAddress: creditCardTopUp,
      method: "updateCard",
      args: {
        index: body.index,
        nickname: body.nickname || "",
        providerId: body.providerId || "",
        destinationChainId: body.destinationChainId,
        externalToken,
        cardWalletAddress,
      },
    },
    userAddress,
    accessToken
  );
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
}

/**
 * Submit removeCard transaction to STRATO.
 */
export async function submitRemoveCard(
  accessToken: string,
  userAddress: string,
  index: number
): Promise<{ status: string; hash: string }> {
  if (!creditCardTopUp) {
    throw new Error("CREDIT_CARD_TOP_UP_ADDRESS is not configured");
  }
  const tx = await buildFunctionTx(
    {
      contractName: extractContractName(CreditCardTopUp),
      contractAddress: creditCardTopUp,
      method: "removeCard",
      args: { index },
    },
    userAddress,
    accessToken
  );
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
}

/**
 * Submit ERC-20 approve(creditCardTopUp, amount) for USDST so the operator can top up on the user's behalf.
 */
export async function submitApproval(
  accessToken: string,
  userAddress: string,
  amount: string
): Promise<TransactionResponse> {
  if (!creditCardTopUp) {
    throw new Error("CREDIT_CARD_TOP_UP_ADDRESS is not configured");
  }
  const tx = await buildFunctionTx(
    [
      {
        contractName: extractContractName(Token),
        contractAddress: USDST,
        method: "approve",
        args: { spender: creditCardTopUp, value: amount },
      },
    ],
    userAddress,
    accessToken
  );
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
}

/**
 * Update last top-up timestamp and clear last error for a card config.
 */
export function markTopUpDone(config: CreditCardConfig): void {
  const key = normalizeAddress(config.userAddress);
  const list = configStore.get(key) ?? [];
  const idx = list.findIndex((c) => c.id === config.id);
  if (idx < 0) return;
  const next = [...list];
  next[idx] = { ...next[idx], lastTopUpAt: new Date().toISOString(), lastError: undefined };
  configStore.set(key, next);
}

/**
 * Update last checked timestamp and optionally set last error for a card config.
 */
export function markChecked(config: CreditCardConfig, error?: string): void {
  const key = normalizeAddress(config.userAddress);
  const list = configStore.get(key) ?? [];
  const idx = list.findIndex((c) => c.id === config.id);
  if (idx < 0) return;
  const next = [...list];
  next[idx] = { ...next[idx], lastCheckedAt: new Date().toISOString(), lastError: error };
  configStore.set(key, next);
}

/**
 * Run the balance watcher: for each enabled config, check card wallet balance on the
 * destination chain; if below threshold and cooldown elapsed, execute a top-up.
 * Requires OPERATOR_ACCESS_TOKEN and CREDIT_CARD_TOP_UP_ADDRESS. Optional
 * EXTERNAL_CHAIN_RPC_URLS (JSON map of chainId -> rpcUrl) for balance checks.
 */
export async function runBalanceWatcher(operatorAccessToken: string): Promise<void> {
  if (!operatorAccessToken) return;
  if (!creditCardTopUp) return;
  const rpcUrls = getExternalChainRpcUrls();
  const configs = getConfigsForWatcher();
  for (const c of configs) {
    try {
      markChecked(c);
      const rpcUrl = rpcUrls[c.destinationChainId];
      if (!rpcUrl) {
        markChecked(c, "No RPC URL for chain " + c.destinationChainId);
        continue;
      }
      const balance = await getErc20Balance(rpcUrl, c.externalToken, c.cardWalletAddress);
      const threshold = BigInt(c.thresholdAmount);
      if (balance >= threshold) continue;
      const lastTopUp = c.lastTopUpAt ? new Date(c.lastTopUpAt).getTime() : 0;
      const cooldownMs = c.cooldownMinutes * 60 * 1000;
      if (Date.now() - lastTopUp < cooldownMs) continue;
      await executeTopUp(operatorAccessToken, {
        userAddress: c.userAddress,
        stratoTokenAmount: c.topUpAmount,
        externalChainId: c.destinationChainId,
        externalRecipient: c.cardWalletAddress,
        externalToken: c.externalToken,
      });
      markTopUpDone(c);
    } catch (err: any) {
      markChecked(c, err?.message ?? "Top-up failed");
    }
  }
}

/**
 * Get card wallet token balance for a config (for display). Returns wei string or null if RPC unavailable.
 */
export async function getCardBalance(config: CreditCardConfig): Promise<string | null> {
  const rpcUrls = getExternalChainRpcUrls();
  const rpcUrl = rpcUrls[config.destinationChainId];
  if (!rpcUrl) return null;
  try {
    const balance = await getErc20Balance(rpcUrl, config.externalToken, config.cardWalletAddress);
    return balance.toString();
  } catch {
    return null;
  }
}
