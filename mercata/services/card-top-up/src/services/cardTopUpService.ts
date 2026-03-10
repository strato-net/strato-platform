import axios from "axios";
import { config } from "../config";
import { getOperatorToken } from "../auth";
import type { WatcherConfig, ExecuteTopUpParams } from "../types";
import { logInfo, logError } from "../utils/logger";
import { appendError } from "../utils/healthMonitor";

const BALANCE_OF_SELECTOR = "0x70a08231";

async function getErc20Balance(
  rpcUrl: string,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const addr = walletAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const data = BALANCE_OF_SELECTOR + addr;
  const to = tokenAddress.startsWith("0x") ? tokenAddress : `0x${tokenAddress}`;
  const res = await axios.post(
    rpcUrl,
    {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to, data }, "latest"],
      id: 1,
    },
    { timeout: 10_000 }
  );
  const result = res.data?.result;
  if (typeof result !== "string" || !result) return 0n;
  return BigInt(result);
}

async function fetchWatcherConfigs(token: string): Promise<WatcherConfig[]> {
  const { baseUrl, timeout } = config.api;
  const url = `${baseUrl.replace(/\/$/, "")}/api/credit-card/watcher-config`;
  const { data } = await axios.get<WatcherConfig[]>(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout,
  });
  return Array.isArray(data) ? data : [];
}

async function executeTopUp(token: string, params: ExecuteTopUpParams): Promise<void> {
  const { baseUrl, timeout } = config.api;
  const url = `${baseUrl.replace(/\/$/, "")}/api/credit-card/execute-top-up`;
  await axios.post(url, params, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout,
  });
}

async function hasPendingTopUps(token: string, cardWalletAddress: string): Promise<boolean> {
  const { baseUrl, timeout } = config.api;
  const url = `${baseUrl.replace(/\/$/, "")}/api/credit-card/watcher-pending`;
  const { data } = await axios.get<Array<{ amount: string; status: number; timestamp: string }>>(url, {
    headers: { Authorization: `Bearer ${token}` },
    params: { cardWalletAddress },
    timeout,
  });
  return Array.isArray(data) && data.length > 0;
}

export async function runTopUpCycle(): Promise<void> {
  let token: string;
  logInfo("CardTopUp", `Starting top-up cycle`);
  try {
    token = await getOperatorToken();
  } catch (err) {
    logError("CardTopUp", err instanceof Error ? err : new Error(String(err)), { operation: "getOperatorToken" });
    return;
  }
  const configs = await fetchWatcherConfigs(token);
  logInfo("CardTopUp", `Watcher config: ${JSON.stringify(configs)}`);
  if (configs.length === 0) return;
  logInfo("CardTopUp", `Checking ${configs.length} card(s)`);
  const rpcUrls = config.rpcUrls;
  for (const c of configs) {
    try {
      const rpcUrl = rpcUrls[c.destinationChainId];
      if (!rpcUrl) {
        logInfo("CardTopUp", `No RPC for chain ${c.destinationChainId}, skipping card ${c.id}`);
        continue;
      }
      const balance = await getErc20Balance(rpcUrl, c.externalToken, c.cardWalletAddress);
      const threshold = BigInt(c.thresholdAmount);
      if (balance >= threshold) continue;
      const lastTopUp = c.lastTopUpAt ? new Date(c.lastTopUpAt).getTime() : 0;
      const cooldownMs = c.cooldownMinutes * 60 * 1000;
      if (Date.now() - lastTopUp < cooldownMs) {
        logInfo("CardTopUp", `Card ${c.id} below threshold but cooldown not elapsed`);
        continue;
      }
      if (await hasPendingTopUps(token, c.cardWalletAddress)) {
        logInfo("CardTopUp", `Card ${c.id} has pending top-up(s), skipping`);
        continue;
      }
      await executeTopUp(token, {
        userAddress: c.userAddress,
        stratoTokenAmount: c.topUpAmount,
        externalChainId: c.destinationChainId,
        externalRecipient: c.cardWalletAddress,
        externalToken: c.externalToken,
      });
      logInfo("CardTopUp", `Topped up card ${c.id} for ${c.userAddress}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logError("CardTopUp", message, { cardId: c.id, userAddress: c.userAddress });
      void appendError({ cardId: c.id, error: message });
    }
  }
}
