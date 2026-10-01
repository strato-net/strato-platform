import { promises as fs } from "node:fs";
import path from "node:path";
import { buildBridgeReviewQueue, type BridgeReviewItem } from "@strato/shared-types";
import { config } from "../config";
import { normalizeOptionalHash } from "../utils/utils";
import { getBridgeReviewRecords, getBridgeReviewOutcome, getWithdrawalRefundEvidence, getSettlementAttestationCount, getSettlementVerifierConfig, getDepositReviewApproval } from "./cirrusService";
import { getStratoNetworkId } from "./bridgeService";
import { buildBridgeDigestRequest, parseBridgeDigest } from "../signer/authorizationValidation";
import { rpc } from "../utils/api";
import { attestWithdrawalRefund } from "./settlementAttestationService";
import { sendBridgeReviewEmail } from "./emailService";
import { logError } from "../utils/logger";
import { getPendingWithdrawalReview } from "./externalWithdrawalService";
import { processingIssueService } from "./processingIssueService";
import { processingIssue } from "../utils/processingIssues";

const normalize = (value: string) => value.replace(/^0x/i, "").toLowerCase();
const notificationPath = path.join(process.cwd(), "data", "bridgeReviewNotifications.json");

export const getBridgeReviewQueue = async (): Promise<BridgeReviewItem[]> => {
  const records = await getBridgeReviewRecords();
  const pendingProposals: Record<string, string> = {};
  const authorizations = new Map(records.authorizations.map(row => [String(row.key), row.value]));
  for (const row of records.withdrawals) {
    const v = row.value;
    if (String(v.status) !== "3" || normalizeOptionalHash(v.externalTxHash) ||
        BigInt(v.authorizationDeadline || "0") < BigInt(Math.floor(Date.now() / 1000))) continue;
    const authorization = authorizations.get(String(row.key));
    if (!authorization?.destinationVault) continue;
    const proposal = await getPendingWithdrawalReview({
      sourceChainId: (await getStratoNetworkId()).toString(), sourceBridge: `0x${normalize(config.externalAssetBridge.address!)}`,
      sourceWithdrawalId: String(row.key), destinationChainId: String(v.externalChainId),
      destinationVault: `0x${normalize(authorization.destinationVault)}`, token: `0x${normalize(v.externalToken)}`,
      recipient: `0x${normalize(v.externalRecipient)}`, amount: String(v.externalTokenAmount),
    });
    if (proposal) pendingProposals[String(row.key)] = proposal;
  }
  return buildBridgeReviewQueue(records, pendingProposals);
};

export const prepareBridgeOperation = async (id: string, action: string): Promise<{ digest: string }> => {
  if (action !== "refund") throw new Error("Unsupported bridge operation");
  const item = buildBridgeReviewQueue(await getBridgeReviewRecords()).find(entry => entry.id === id);
  if (!item || !item.actions.some(allowed => allowed === action)) throw new Error("Review action is unavailable; refresh the queue");
  if (item.kind !== "withdrawal_refund") throw new Error("Deposit refunds require a governance decision on STRATO");
  return prepareWithdrawalRefund(item.reference);
};

const prepareWithdrawalRefund = async (reference: string): Promise<{ digest: string }> => {
  const target = config.externalAssetBridge.address!;
  const evidence = await getWithdrawalRefundEvidence(reference);
  const { withdrawal: w, authorization: a, verifierVersion } = evidence;
  if (!w || String(w.status) !== "3" || !a?.destinationVault || verifierVersion == null) throw new Error("Withdrawal refund evidence is unavailable");
  const authorization = {
    sourceChainId: (await getStratoNetworkId()).toString(), sourceBridge: `0x${normalize(target)}`,
    sourceWithdrawalId: reference, destinationChainId: String(w.externalChainId),
    destinationVault: `0x${normalize(a.destinationVault)}`, token: `0x${normalize(w.externalToken)}`,
    recipient: `0x${normalize(w.externalRecipient)}`, amount: String(w.externalTokenAmount),
    notBefore: String(a.notBefore), deadline: String(a.deadline), signerSetVersion: String(a.signerSetVersion),
  };
  const digest = parseBridgeDigest(await rpc.post("", buildBridgeDigestRequest(target, "getWithdrawalRefundDigest", [reference])));
  const [count, verifierConfig] = await Promise.all([getSettlementAttestationCount(digest), getSettlementVerifierConfig()]);
  if (!Number.isSafeInteger(verifierConfig.threshold) || verifierConfig.threshold < 2) throw new Error("Refund verifier threshold is unavailable");
  if (count < verifierConfig.threshold) {
    await attestWithdrawalRefund(authorization, digest);
    const indexedCount = await getSettlementAttestationCount(digest);
    if (indexedCount < verifierConfig.threshold) throw Object.assign(new Error("Refund attestations are not indexed yet; retry before voting"), {
      issues: [processingIssue("INDEXING_PENDING", { available: String(indexedCount), required: String(verifierConfig.threshold) })],
    });
  }
  return { digest };
};

export const preparePendingWithdrawalRefunds = async (): Promise<void> => {
  const items = buildBridgeReviewQueue(await getBridgeReviewRecords());
  for (const item of items.filter(item => item.source === "eab" && item.kind === "withdrawal_refund")) {
    await processingIssueService.run({ source: "eab", chainId: item.chainId, bridge: config.externalAssetBridge.address!,
      reference: item.reference, stage: "withdrawal-refund", token: item.token }, () => prepareWithdrawalRefund(item.reference));
  }
};

export const notifyBridgeReviews = async (): Promise<void> => {
  const current = await getBridgeReviewQueue();
  let saved: Record<string, BridgeReviewItem> = {};
  try { saved = JSON.parse(await fs.readFile(notificationPath, "utf8")); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved) ||
      Object.entries(saved).some(([id, item]) => !item || item.id !== id || !Array.isArray(item.actions))) {
    throw new Error("Invalid bridge review notification journal; restore it before notifying");
  }
  let failed = false;
  const persist = async () => {
    await fs.mkdir(path.dirname(notificationPath), { recursive: true });
    await fs.writeFile(`${notificationPath}.tmp`, JSON.stringify(saved), { mode: 0o600 });
    await fs.rename(`${notificationPath}.tmp`, notificationPath);
  };
  const present = new Set(current.map(item => item.id));
  for (const item of current) {
    try {
      if (item.recoveryStatus === "reopened" || (item.recoveryStatus === "refund_pending" && !normalizeOptionalHash(item.safeProposalHash) && !item.refundEvidenceHash)) {
        if (saved[item.id] && JSON.stringify(saved[item.id]) !== JSON.stringify(item)) {
          saved[item.id] = item; await persist();
        }
        continue;
      }
      if (item.kind === "withdrawal_review" && !normalizeOptionalHash(item.safeProposalHash)) continue;
      if (item.kind === "withdrawal_refund") {
        item.reviewDigest = parseBridgeDigest(await rpc.post("", buildBridgeDigestRequest(config.externalAssetBridge.address!, "getWithdrawalRefundDigest", [item.reference])));
        const [count, verifierConfig] = await Promise.all([getSettlementAttestationCount(item.reviewDigest), getSettlementVerifierConfig()]);
        if (!Number.isSafeInteger(verifierConfig.threshold) || verifierConfig.threshold < 2) throw new Error("Refund verifier threshold is unavailable");
        if (count < verifierConfig.threshold) continue;
      }
      if (item.source === "eab" && item.kind === "deposit_review") {
        const [, , chainId, router, depositId] = item.id.split(":");
        const approval = normalizeOptionalHash(await getDepositReviewApproval(chainId, router, depositId));
        if (approval) {
          const digest = parseBridgeDigest(await rpc.post("", buildBridgeDigestRequest(config.externalAssetBridge.address!, "getReviewedDepositDigest", [chainId, `0x${normalize(router)}`, depositId])));
          if (normalize(approval) === normalize(digest)) {
            if (saved[item.id]) {
              delete saved[item.id]; await persist();
            }
            continue;
          }
        }
      }
      if (JSON.stringify(saved[item.id]) === JSON.stringify(item)) continue;
      await sendBridgeReviewEmail(item); saved[item.id] = item; await persist();
    }
    catch (error) { failed = true; logError("BridgeReviewNotification", error as Error, { reviewId: item.id }); }
  }
  for (const [id, item] of Object.entries(saved)) {
    if (present.has(id)) continue;
    try {
      const outcome = await getBridgeReviewOutcome(item);
      if (!outcome) continue;
      delete saved[id]; await persist();
    }
    catch (error) { failed = true; logError("BridgeReviewNotification", error as Error, { reviewId: id }); }
  }
  if (failed) throw new Error("Bridge review email delivery failed; unsent notifications will be retried");
};
