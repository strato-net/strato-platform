import axios from "axios";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato } from "../../utils/mercataApiHelper";
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

/** In-memory store keyed by user address (STRATO). Production should use a persistent store. */
const configStore = new Map<string, CreditCardConfig>();

function normalizeAddress(addr: string): string {
  return addr?.toLowerCase().replace(/^0x/, "") ?? "";
}

export function getConfig(userAddress: string): CreditCardConfig | null {
  const key = normalizeAddress(userAddress);
  return configStore.get(key) ?? null;
}

export function upsertConfig(userAddress: string, config: Omit<CreditCardConfig, "userAddress">): CreditCardConfig {
  const key = normalizeAddress(userAddress);
  const full: CreditCardConfig = {
    ...config,
    userAddress: userAddress,
  };
  configStore.set(key, full);
  return full;
}

export function deleteConfig(userAddress: string): boolean {
  const key = normalizeAddress(userAddress);
  return configStore.delete(key);
}

/** Returns all enabled configs for the balance watcher. */
export function getConfigsForWatcher(): CreditCardConfig[] {
  return Array.from(configStore.values()).filter((c) => c.enabled);
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
 * Update last top-up timestamp and clear last error for a user.
 */
export function markTopUpDone(userAddress: string): void {
  const key = normalizeAddress(userAddress);
  const c = configStore.get(key);
  if (c) {
    configStore.set(key, { ...c, lastTopUpAt: new Date().toISOString(), lastError: undefined });
  }
}

/**
 * Update last checked timestamp and optionally set last error.
 */
export function markChecked(userAddress: string, error?: string): void {
  const key = normalizeAddress(userAddress);
  const c = configStore.get(key);
  if (c) {
    configStore.set(key, { ...c, lastCheckedAt: new Date().toISOString(), lastError: error });
  }
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
      markChecked(c.userAddress);
      const rpcUrl = rpcUrls[c.destinationChainId];
      if (!rpcUrl) {
        markChecked(c.userAddress, "No RPC URL for chain " + c.destinationChainId);
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
      markTopUpDone(c.userAddress);
    } catch (err: any) {
      markChecked(c.userAddress, err?.message ?? "Top-up failed");
    }
  }
}
