import { ExternalBridgeStatus } from "./bridge-types";
import type { BridgeReviewItem, BridgeReviewRecords } from "./bridge-types";

const nonzeroHash = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized && !/^0+$/.test(normalized.replace(/^0x/i, "")) ? normalized : undefined;
};

// Pure projection shared by the app queue and the independent email worker.
export const buildBridgeReviewQueue = (
  records: BridgeReviewRecords, pendingProposals: Record<string, string> = {},
): BridgeReviewItem[] => {
  const items: BridgeReviewItem[] = [];
  const reviews = new Map(records.reviews.map(row => [String(row.key), row.value]));

  for (const row of records.deposits) {
    const v = row.value;
    const status = Number(v.status ?? NaN);
    if (status === 9) continue;
    const recovery = status === 0 || status === 7 || status === 8;
    if (status === 0 && !nonzeroHash(v.externalTxHash)) continue;
    items.push({ id: `eab:deposit:${row.key}:${row.key2}:${row.key3}`, source: "eab", kind: recovery ? "deposit_recovery" : "deposit_review",
      ...(recovery ? { recoveryStatus: status === 8 ? "refund_pending" as const : status === 0 ? "reopened" as const : "rejected" as const } : {}),
      chainId: String(row.key), reference: String(row.key3), token: v.stratoToken,
      amount: String(v.stratoTokenAmount), account: v.stratoRecipient,
      refundRecipient: v.externalSender, refundToken: v.externalToken, refundAmount: String(v.externalTokenAmount),
      reason: status === 8 ? "Return of funds authorized. The bridge verifies the original custody evidence and retries the refund automatically; settlement is permanently disabled."
        : recovery ? status === 0
        ? "Governance reopened this deposit. The bridge retries verification and processing automatically. Funds have not yet been delivered or returned."
        : "Rejected deposit awaiting recovery. External funds have not been returned. Keep this item open until delivery or a verified refund completes."
        : "Review the external deposit evidence. Approve received funds, reject and refund received funds, or reject without refund only after verifying no funds were received.",
      actions: recovery ? status === 7 ? ["approve", "refund", "reject"] : [] : ["approve", "refund", "reject"],
    });
  }
  for (const row of records.withdrawals) {
    const v = row.value;
    if (nonzeroHash(v.externalTxHash)) continue;
    const expired = String(v.status) === "3" && BigInt(v.authorizationDeadline || "0") > 0n &&
      BigInt(v.authorizationDeadline) < BigInt(Math.floor(Date.now() / 1000));
    let proposal = nonzeroHash(reviews.get(String(row.key))?.proposalHash) || undefined;
    if (String(v.status) === "3" && !expired) {
      proposal = pendingProposals[String(row.key)];
      if (!proposal) continue;
    }

    const pending = !expired;
    items.push({ id: `eab:withdrawal:${row.key}`, source: "eab", kind: pending ? "withdrawal_review" : "withdrawal_refund",
      chainId: String(v.externalChainId), reference: String(row.key), token: v.stratoToken,
      amount: String(v.stratoTokenAmount), account: v.stratoSender,
      reason: pending ? "Safe approval is required before this withdrawal can proceed."
        : "Authorization expired. Refund requires verifier confirmation that no external payment occurred; expiry alone is not proof of non-payment.",
      ...(proposal ? { safeProposalHash: proposal } : {}),
      actions: pending ? [] : ["refund"],
    });
  }
  for (const source of ["native", "legacy"] as const) {
    const deposits = source === "native" ? records.nativeDeposits : records.legacyDeposits;
    const withdrawals = source === "native" ? records.nativeWithdrawals : records.legacyWithdrawals;
    for (const row of deposits) {
      const v = row.value;
      if (source === "native" && String(v.bridgeStatus) === "9") continue;
      const recovery = source === "native" && ["4", "7"].includes(String(v.bridgeStatus));
      const refunding = source === "native" && String(v.bridgeStatus) === "7";
      const evidence = refunding && /^(0x)?[a-f0-9]{64}$/i.test(v.refundEvidenceHash || "") ? nonzeroHash(v.refundEvidenceHash) : undefined;
      items.push({ id: `${source}:deposit:${row.key}:${row.key2 || ""}`, source, kind: recovery ? "deposit_recovery" : "deposit_review",
        ...(recovery ? { recoveryStatus: refunding ? "refund_pending" as const : "rejected" as const } : {}),
        chainId: String(v.externalChainId || row.key), reference: String(row.key2 || row.key),
        token: v.stratoToken, amount: String(v.stratoTokenAmount), account: v.stratoRecipient,
        ...(source === "native" ? { refundRecipient: v.externalSender, refundToken: v.representationToken, refundAmount: String(v.stratoTokenAmount), refundBridge: v.externalBridge, refundRedemptionId: String(v.externalRedemptionId) } : {}),
        reason: evidence ? "The operator reports a confirmed external refund. Independently verify the transaction, original asset, sender and amount before voting to mark this deposit Refunded. STRATO custody remains locked."
          : refunding ? "Return of funds authorized. The bridge will restore the original external representations after verifying the burn; STRATO custody remains locked."
          : recovery ? "Rejected redemption awaiting recovery. Choose delivery on STRATO or restoration of the original external representations."
          : "Operator evidence review is required. Do not override failed custody verification or treat cancellation as an external refund.",
        actions: source === "native" ? refunding ? evidence ? ["confirm_refund"] : [] : recovery ? ["approve", "refund", "reject"] : ["refund", "reject"] : [],
        ...(evidence ? { refundEvidenceHash: evidence } : {}),
        ...(!evidence && refunding && nonzeroHash(v.refundProposalHash) ? { safeProposalHash: nonzeroHash(v.refundProposalHash) } : {}),
      });
    }
    for (const row of withdrawals) {
      const v = row.value;
      if (source === "native" && String(v.bridgeStatus) === "2" && (v.useInstantPath === true || String(v.useInstantPath) === "true")) continue;
      if (source === "native" && String(v.bridgeStatus) === String(ExternalBridgeStatus.CANCELLATION_PENDING)) {
        const evidence = /^(0x)?[a-f0-9]{64}$/i.test(v.cancellationTxHash || "") ? nonzeroHash(v.cancellationTxHash) : undefined;
        items.push({ id: `native:withdrawal:${row.key}`, source, kind: "withdrawal_cancellation",
          chainId: String(v.externalChainId), reference: String(row.key), token: v.stratoToken,
          amount: String(v.stratoTokenAmount), account: v.stratoSender, refundBridge: v.externalBridge,
          reason: evidence ? "Verify the confirmed external mint cancellation before returning STRATO escrow."
            : "Cancellation requested. Escrow remains locked until the external mint identity is permanently canceled.",
          ...(evidence ? { refundEvidenceHash: evidence } : {}),
          ...(nonzeroHash(v.cancellationProposalHash) ? { safeProposalHash: nonzeroHash(v.cancellationProposalHash) } : {}),
          actions: evidence ? ["confirm_cancellation"] : [],
        });
        continue;
      }
      const proposal = nonzeroHash(source === "native" ? v.nativeMintProposalHash : v.custodyTxHash);
      items.push({ id: `${source}:withdrawal:${row.key}`, source, kind: "withdrawal_review",
        chainId: String(v.externalChainId), reference: String(row.key), token: v.stratoToken,
        amount: String(v.stratoTokenAmount), account: v.stratoSender,
        reason: proposal ? "Review and execute the Safe proposal to proceed." : "The bridge operator is preparing the Safe proposal.",
        ...(proposal ? { safeProposalHash: proposal } : {}), actions: source === "native" ? ["cancel_withdrawal"] : [],
      });
    }
  }
  return items;
};
