import axios from "axios";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getRpcUpstream } from "../../config/rpc.config";
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

function normalizeAddress(addr: string): string {
  return addr?.toLowerCase().replace(/^0x/, "") ?? "";
}

function mapCirrusRowToConfig(
  userAddress: string,
  key2: number,
  v: CardRowFromCirrus["value"]
): CreditCardConfig {
  const raw = v ?? {};
  const thresholdAmount = typeof raw.thresholdAmount === "string" ? raw.thresholdAmount : (raw.thresholdAmount != null ? String(raw.thresholdAmount) : "0");
  const cooldownMinutes = typeof raw.cooldownMinutes === "number" ? raw.cooldownMinutes : (raw.cooldownMinutes != null ? Number(raw.cooldownMinutes) : 0);
  const topUpAmount = typeof raw.topUpAmount === "string" ? raw.topUpAmount : (raw.topUpAmount != null ? String(raw.topUpAmount) : "0");
  const lastTopUpTimestamp = raw.lastTopUpTimestamp != null ? Number(raw.lastTopUpTimestamp) : 0;
  return {
    id: String(key2),
    userAddress,
    nickname: typeof raw.nickname === "string" ? raw.nickname : undefined,
    providerId: typeof raw.providerId === "string" ? raw.providerId : undefined,
    destinationChainId: String(raw.destinationChainId ?? "0"),
    externalToken: typeof raw.externalToken === "string" ? raw.externalToken : "",
    cardWalletAddress: typeof raw.cardWalletAddress === "string" ? raw.cardWalletAddress : "",
    thresholdAmount,
    topUpAmount,
    useBorrow: false,
    checkFrequencyMinutes: 5,
    cooldownMinutes,
    enabled: true,
    lastTopUpAt: lastTopUpTimestamp > 0 ? new Date(lastTopUpTimestamp * 1000).toISOString() : undefined,
  };
}

/**
 * Card row from Cirrus userCards table (value may be struct with nickname, providerId, etc.).
 */
export type CardRowFromCirrus = {
  key?: string;
  key2?: number;
  value?: {
    nickname?: string;
    providerId?: string;
    destinationChainId?: string | number;
    externalToken?: string;
    cardWalletAddress?: string;
    thresholdAmount?: string;
    cooldownMinutes?: string | number;
    topUpAmount?: string;
    lastTopUpTimestamp?: string | number;
  };
};

/**
 * Get a user's cards from Cirrus (CreditCardTopUp-userCards table). No RPC/eth_call.
 */
export async function getCardsFromCirrus(
  accessToken: string,
  userAddress: string
): Promise<Array<{
  id: string;
  nickname?: string;
  providerId?: string;
  destinationChainId: string;
  externalToken: string;
  cardWalletAddress: string;
  thresholdAmount?: string;
  cooldownMinutes?: string;
  topUpAmount?: string;
  lastTopUpTimestamp?: string;
}>> {
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
        thresholdAmount: typeof v.thresholdAmount === "string" ? v.thresholdAmount : (v.thresholdAmount != null ? String(v.thresholdAmount) : undefined),
        cooldownMinutes: v.cooldownMinutes != null ? String(v.cooldownMinutes) : undefined,
        topUpAmount: typeof v.topUpAmount === "string" ? v.topUpAmount : (v.topUpAmount != null ? String(v.topUpAmount) : undefined),
        lastTopUpTimestamp: v.lastTopUpTimestamp != null ? String(v.lastTopUpTimestamp) : undefined,
      };
    });
  } catch (err) {
    console.error("getCardsFromCirrus:", err);
    return [];
  }
}

/**
 * Get all cards from Cirrus (all users) for the watcher. Query without key filter.
 */
export async function getAllCardsFromCirrus(accessToken: string): Promise<CreditCardConfig[]> {
  if (!creditCardTopUp) return [];
  try {
    const { data } = await cirrus.get(accessToken, `/${CreditCardTopUp}-userCards`, {
      params: {
        select: "key,key2,value",
        address: `eq.${creditCardTopUp}`,
        order: "key.asc,key2.asc",
      },
    });
    if (!Array.isArray(data)) return [];
    return data.map((row: CardRowFromCirrus) => {
      const userAddress = typeof row?.key === "string" ? row.key : "";
      const key2 = row?.key2 ?? 0;
      return mapCirrusRowToConfig(userAddress, key2, row?.value);
    });
  } catch (err) {
    console.error("getAllCardsFromCirrus:", err);
    return [];
  }
}

/**
 * Fetch cards from Cirrus for the watcher with filter: only auto top-up enabled
 * (thresholdAmount > 0 or topUpAmount > 0). Uses or=(thresholdAmount.gt.0,topUpAmount.gt.0)
 * when the API supports it; always filters in memory so behavior is correct.
 */
export async function getConfigsForWatcher(accessToken: string): Promise<CreditCardConfig[]> {
  if (!creditCardTopUp) return [];
  try {
    const params: Record<string, string> = {
      select: "key,key2,value",
      address: `eq.${creditCardTopUp}`,
      order: "key.asc,key2.asc",
      or: "(thresholdAmount.gt.0,topUpAmount.gt.0)",
    };
    const { data } = await cirrus.get(accessToken, `/${CreditCardTopUp}-userCards`, { params });
    if (!Array.isArray(data)) return [];
    const configs = data.map((row: CardRowFromCirrus) => {
      const userAddress = typeof row?.key === "string" ? row.key : "";
      const key2 = row?.key2 ?? 0;
      return mapCirrusRowToConfig(userAddress, key2, row?.value);
    });
    return configs.filter(
      (c) => BigInt(c.thresholdAmount ?? "0") > 0n || BigInt(c.topUpAmount ?? "0") > 0n
    );
  } catch (err) {
    const all = await getAllCardsFromCirrus(accessToken);
    return all.filter(
      (c) => BigInt(c.thresholdAmount ?? "0") > 0n || BigInt(c.topUpAmount ?? "0") > 0n
    );
  }
}

/** Get configs for one user from Cirrus (on-chain cards as CreditCardConfig shape). */
export async function getConfigs(accessToken: string, userAddress: string): Promise<CreditCardConfig[]> {
  const rows = await getCardsFromCirrus(accessToken, userAddress);
  return rows.map((r, i) => mapCirrusRowToConfig(userAddress, Number(r.id) || i, {
    nickname: r.nickname,
    providerId: r.providerId,
    destinationChainId: r.destinationChainId,
    externalToken: r.externalToken,
    cardWalletAddress: r.cardWalletAddress,
    thresholdAmount: r.thresholdAmount,
    cooldownMinutes: r.cooldownMinutes != null ? Number(r.cooldownMinutes) : undefined,
    topUpAmount: r.topUpAmount,
    lastTopUpTimestamp: r.lastTopUpTimestamp != null ? Number(r.lastTopUpTimestamp) : undefined,
  }));
}

/** Get one config by user and id (card index) from Cirrus. */
export async function getConfigById(accessToken: string, userAddress: string, id: string): Promise<CreditCardConfig | null> {
  const list = await getConfigs(accessToken, userAddress);
  return list.find((c) => c.id === id) ?? null;
}

/**
 * Execute a single top-up by calling CreditCardTopUp.topUpCard as the operator.
 * Must be called with an operator access token (e.g. from env OPERATOR_ACCESS_TOKEN).
 * Contract address must be set in config (CREDIT_CARD_TOP_UP_ADDRESS).
 */
export async function executeTopUp(
  accessToken: string,
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
  console.log(`TX: ${JSON.stringify(tx)}`)
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
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
    thresholdAmount: string;
    cooldownMinutes: number;
    topUpAmount: string;
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
        thresholdAmount: body.thresholdAmount,
        cooldownMinutes: body.cooldownMinutes,
        topUpAmount: body.topUpAmount,
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
    thresholdAmount: string;
    cooldownMinutes: number;
    topUpAmount: string;
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
        thresholdAmount: body.thresholdAmount,
        cooldownMinutes: body.cooldownMinutes,
        topUpAmount: body.topUpAmount,
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
 * Run the balance watcher: for each card from Cirrus, check card wallet balance on the
 * destination chain; if below threshold and cooldown elapsed, execute a top-up.
 * Contract updates lastTopUpTimestamp on chain when topUpCard is called.
 */
export async function runBalanceWatcher(operatorAccessToken: string): Promise<void> {
  if (!operatorAccessToken) return;
  if (!creditCardTopUp) return;
  const rpcUrls = getExternalChainRpcUrls();
  const configs = await getConfigsForWatcher(operatorAccessToken);
  for (const c of configs) {
    try {
      const rpcUrl = rpcUrls[c.destinationChainId];
      if (!rpcUrl) continue;
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
    } catch {
      // continue to next card
    }
  }
}

/**
 * Fetch pending bridge withdrawals for a card's wallet address.
 * Queries MercataBridge-withdrawals from Cirrus where externalRecipient matches
 * and bridgeStatus is INITIATED (1) or PENDING_REVIEW (2).
 */
export async function getPendingWithdrawalsForCard(
  accessToken: string,
  cardWalletAddress: string
): Promise<Array<{ amount: string; status: number; timestamp: string }>> {
  const bridgeAddress = process.env.BRIDGE_ADDRESS;
  if (!bridgeAddress) return [];
  const normalizedWallet = normalizeAddress(cardWalletAddress);
  if (!normalizedWallet) return [];
  try {
    const { data } = await cirrus.get(accessToken, "/BlockApps-MercataBridge-withdrawals", {
      params: {
        select: "key,value",
        address: `eq.${bridgeAddress}`,
        or: "(value->>bridgeStatus.eq.1,value->>bridgeStatus.eq.2)",
        "value->>externalRecipient": `eq.${normalizedWallet}`,
        order: "value->>requestedAt.desc",
      },
    });
    if (!Array.isArray(data)) return [];
    return data.map((row: any) => {
      const v = row?.value ?? {};
      return {
        amount: String(v.stratoTokenAmount ?? "0"),
        status: Number(v.bridgeStatus ?? 0),
        timestamp: v.requestedAt
          ? new Date(Number(v.requestedAt) * 1000).toISOString()
          : new Date().toISOString(),
      };
    });
  } catch (err) {
    console.error("getPendingWithdrawalsForCard:", err);
    return [];
  }
}

/**
 * Get card wallet token balance for a config (for display). Returns wei string or null if RPC unavailable.
 */
export async function getCardBalance(config: CreditCardConfig): Promise<string | null> {
  const chainIdStr = String(config.destinationChainId);
  const rpcUrls = getExternalChainRpcUrls();
  let rpcUrl = rpcUrls[chainIdStr];
  if (!rpcUrl) {
    const { upstream, fallback } = getRpcUpstream(chainIdStr);
    const candidate = upstream ?? fallback;
    if (!candidate) return null;
    rpcUrl = candidate;
  }
  if (!rpcUrl) return null;
  try {
    const balance = await getErc20Balance(rpcUrl, config.externalToken, config.cardWalletAddress);
    return balance.toString();
  } catch {
    return null;
  }
}
