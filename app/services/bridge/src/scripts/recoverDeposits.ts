/**
 * Record deposits the relayer missed, one source transaction at a time.
 *
 *   npm run recover-deposits -- --chain 1 --tx 0xabc… --tx 0xdef… [--chain 8453 --tx 0x…] [--execute]
 *
 * Every deposit is rebuilt from its own DepositRouted event, so nothing is typed by hand.
 * No checkpoint is touched, so a run cannot affect what the relayer scans next. Deposits the
 * bridge already holds are skipped, and the normal poller verifies and mints whatever this
 * records. Dry run unless --execute is passed.
 */
import { DEPOSIT_EVENT_SIGNATURES } from "../config";
import { WindowDeposit } from "../types";
import { getEnabledChains, getRebaseFactors, getRecordedDepositKeys } from "../services/cirrusService";
import { getTransactionReceiptsBatch, isChainConfigured } from "../services/rpcService";
import {
  canonicalDepositKey,
  extractWindowDeposits,
  RawDepositLog,
} from "../services/depositEventService";
import { depositRecorder } from "../services/depositRecorder";
import { logError, logInfo } from "../utils/logger";
import { initOpenIdConfig } from "../auth";
import { WAD } from "../config";

export interface RecoveryRequest {
  externalChainId: number;
  txHashes: string[];
}

// --chain <id> switches the chain that following --tx hashes belong to
export const parseRecoveryArgs = (argv: string[]) => {
  const requests: RecoveryRequest[] = [];
  let execute = false;
  let chainId: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") {
      execute = true;
    } else if (arg === "--chain") {
      chainId = Number(argv[++i]);
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`--chain needs a chain id, got "${argv[i]}"`);
      }
    } else if (arg === "--tx") {
      const txHash = (argv[++i] || "").trim().toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
        throw new Error(`--tx needs a 32-byte transaction hash, got "${argv[i]}"`);
      }
      if (!chainId) throw new Error("--tx given before any --chain");
      const request = requests.find((r) => r.externalChainId === chainId);
      if (request) request.txHashes.push(txHash);
      else requests.push({ externalChainId: chainId, txHashes: [txHash] });
    } else {
      throw new Error(`Unknown argument "${arg}"`);
    }
  }

  if (requests.length === 0) throw new Error("Nothing to do: pass --chain <id> --tx <hash>");
  return { requests, execute };
};

// The deposit events a source transaction emitted, as the relayer would have read them
export const depositsFromReceipt = (
  receipt: any,
  depositRouter: string,
  externalChainId: number,
): WindowDeposit[] => {
  const router = depositRouter.toLowerCase().replace(/^0x/, "");
  const signatures = DEPOSIT_EVENT_SIGNATURES.map((s) => s.toLowerCase());
  const logs = ((receipt?.logs ?? []) as RawDepositLog[]).filter(
    (log) =>
      (log.address || "").toLowerCase().replace(/^0x/, "") === router &&
      signatures.includes((log.topics?.[0] || "").toLowerCase()),
  );
  return extractWindowDeposits(logs, externalChainId);
};

const applyRebaseFactors = async (deposits: WindowDeposit[]) => {
  if (deposits.length === 0) return;
  const factors = await getRebaseFactors([...new Set(deposits.map((d) => d.targetStratoToken))]);
  for (const deposit of deposits) {
    const factor = factors.get(deposit.targetStratoToken.toLowerCase().replace(/^0x/, ""));
    if (!factor) continue;
    const original = BigInt(deposit.externalTokenAmount);
    deposit.externalTokenAmount = ((original * WAD) / factor).toString();
    logInfo("RecoverDeposits", `Rebasing ${deposit.depositKey}: ${original} → ${deposit.externalTokenAmount}`);
  }
};

const describe = (deposit: WindowDeposit) =>
  [
    `  deposit id ${deposit.depositId}`,
    `key          ${deposit.depositKey}`,
    `token        ${deposit.externalToken}`,
    `amount       ${deposit.externalTokenAmount}`,
    `recipient    ${deposit.stratoRecipient}`,
    `target       ${deposit.targetStratoToken}`,
    `action       ${deposit.action}`,
    `source block ${deposit.blockNumber}`,
  ].join("\n    ");

export const recoverDeposits = async (argv: string[]) => {
  const { requests, execute } = parseRecoveryArgs(argv);
  await initOpenIdConfig();
  const chains = await getEnabledChains();

  let recorded = 0;
  let skipped = 0;
  let failed = 0;

  for (const { externalChainId, txHashes } of requests) {
    const chain = chains.get(externalChainId);
    if (!chain) throw new Error(`Chain ${externalChainId} is not enabled on the bridge`);
    if (!isChainConfigured(externalChainId)) {
      throw new Error(`CHAIN_${externalChainId}_RPC_URL is not configured`);
    }

    const receipts = await getTransactionReceiptsBatch(externalChainId, txHashes);
    const deposits: WindowDeposit[] = [];
    for (const txHash of txHashes) {
      const receipt = receipts.get(txHash);
      if (!receipt) throw new Error(`No receipt for ${txHash} on chain ${externalChainId}`);
      const status = receipt.status;
      if (!(status === 1 || status === true || String(status).toLowerCase() === "0x1")) {
        throw new Error(`Source transaction ${txHash} did not succeed; it deposited nothing`);
      }
      const found = depositsFromReceipt(receipt, chain.depositRouter, externalChainId);
      if (found.length === 0) {
        throw new Error(`${txHash} has no deposit event from router ${chain.depositRouter}`);
      }
      deposits.push(...found);
    }

    await applyRebaseFactors(deposits);

    // Anything the bridge already holds is left alone
    const already = await getRecordedDepositKeys(
      externalChainId,
      deposits.map((d) => canonicalDepositKey(d.depositKey)),
    );
    const missing = deposits.filter((d) => !already.has(canonicalDepositKey(d.depositKey)));
    skipped += deposits.length - missing.length;

    console.log(`\nchain ${externalChainId}: ${deposits.length} deposit(s) found, ${missing.length} to record`);
    for (const deposit of deposits) {
      const state = already.has(canonicalDepositKey(deposit.depositKey)) ? "ALREADY RECORDED" : "TO RECORD";
      console.log(`\n  [${state}]\n  ${describe(deposit)}`);
    }

    if (missing.length === 0 || !execute) continue;

    try {
      await depositRecorder.recordDeposits(externalChainId, missing);
      recorded += missing.length;
    } catch (error) {
      failed += missing.length;
      logError("RecoverDeposits", error as Error, {
        operation: "recordDeposits",
        externalChainId,
        depositKeys: missing.map((d) => d.depositKey),
      });
    }
  }

  console.log(
    execute
      ? `\nDone: ${recorded} recorded, ${skipped} already present, ${failed} failed.` +
          (recorded ? " The relayer verifies and mints them on its next pass." : "")
      : `\nDry run: ${skipped} already present, ${requests.reduce((n, r) => n + r.txHashes.length, 0) - skipped} would be recorded. Re-run with --execute.`,
  );
  return { recorded, skipped, failed };
};

if (require.main === module) {
  recoverDeposits(process.argv.slice(2))
    .then(({ failed }) => process.exit(failed > 0 ? 1 : 0))
    .catch((error) => {
      console.error(`\n${(error as Error).message}`);
      process.exit(1);
    });
}
