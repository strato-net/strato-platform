/**
 * Anchors the blocks holding recent deposits, ahead of anyone claiming them.
 *
 * Independent of the deposit-relay loop and of its cursor on purpose: this one
 * rescans a fixed window of recent history every pass, so an anchor that
 * failed because the block was not yet finalized -- the normal case for a
 * fresh deposit -- is simply retried next time, without any durable state to
 * get stuck.
 */

import { config, DEPOSIT_EVENT_SIGNATURES } from "../config";
import { getEnabledChains } from "../services/cirrusService";
import { getChainLogs, getCurrentBlockNumber, isChainConfigured } from "../services/rpcService";
import { anchorDepositBlock } from "../services/anchorService";
import { proverConfigured, proverReady } from "../services/proverService";
import { logInfo, logError } from "../utils/logger";

/** How far back to rescan each pass. Sepolia finality is ~13 minutes, so the
 *  window has to comfortably outlast it or fresh deposits would age out of it
 *  before they ever became anchorable. */
const LOOKBACK_BLOCKS = Number(process.env.ANCHOR_LOOKBACK_BLOCKS || 400);

/** Deposits handled per pass, so one busy chain cannot monopolise the loop --
 *  each anchor costs a ~35s proof. */
const MAX_PER_PASS = Number(process.env.ANCHOR_MAX_PER_PASS || 5);

const pollChain = async (chainInfo: { externalChainId: number; depositRouter: string }) => {
  const { externalChainId, depositRouter } = chainInfo;
  if (!isChainConfigured(externalChainId)) return;

  const head = await getCurrentBlockNumber(externalChainId);
  const from = Math.max(0, head - LOOKBACK_BLOCKS);
  const logs = (await getChainLogs(
    externalChainId, from, head, depositRouter, DEPOSIT_EVENT_SIGNATURES,
  )) as Array<{ transactionHash: string }>;
  if (!logs.length) return;

  // One anchor covers every deposit in a block, and several deposits often
  // share one; dedupe by tx and let the plan's alreadyAnchored do the rest.
  const seen = new Set<string>();
  const txs = logs.map((l) => l.transactionHash).filter((h) => h && !seen.has(h) && seen.add(h));

  logInfo("AnchorPolling", `chain ${externalChainId}: ${txs.length} deposit tx in blocks ${from}-${head}`);
  for (const txHash of txs.slice(0, MAX_PER_PASS)) {
    await anchorDepositBlock(String(externalChainId), txHash);
  }
};

export const startAnchorPolling = () => {
  if (!proverConfigured()) {
    logInfo("AnchorPolling", "PROVER_URL unset — not anchoring; users anchor their own claims");
    return;
  }
  const interval = config.polling.anchorInterval || 5 * 60 * 1000;

  const poll = async () => {
    try {
      if (!(await proverReady())) {
        // Cold setup with a ceremony SRS is minutes. Queuing anchors behind it
        // would just pile up timeouts.
        logInfo("AnchorPolling", "prover is not ready yet; skipping this pass");
        return;
      }
      const chains = await getEnabledChains();
      if (!chains.size) return;
      const infos = Array.from(chains.values());
      const results = await Promise.allSettled(infos.map(pollChain));
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          logError("AnchorPolling", r.reason, { operation: "pollChain", chain: infos[i] });
        }
      });
    } catch (e) {
      logError("AnchorPolling", e as Error, { operation: "startAnchorPolling" });
    }
  };

  poll();
  setInterval(poll, interval);
};

export default { startAnchorPolling };
