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
      externalBridge: String(row.key2), externalTxHash: nonzeroHash(v.externalTxHash),
      externalAccount: v.externalSender, externalToken: v.externalToken, externalAmount: String(v.externalTokenAmount),
      refundRecipient: v.externalSender, refundToken: v.externalToken, refundAmount: String(v.externalTokenAmount),
      scenario: status === 8 ? "Deposit refund in progress" : status === 0 ? "Deposit delivery retry"
        : recovery ? "Deposit recovery decision" : "Deposit evidence review",
      reason: status === 8 ? "The bridge is returning the original external asset."
        : recovery ? status === 0
        ? "Delivery was reopened and is being retried."
        : "Choose verified delivery, an external refund, or rejection when no funds were received."
        : "Verify whether the external deposit was received and choose its disposition.",
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
      externalAccount: v.externalRecipient, externalToken: v.externalToken, externalAmount: String(v.externalTokenAmount),
      scenario: pending ? "Withdrawal Safe approval" : "Expired withdrawal refund",
      reason: pending ? "The external payment requires Safe approval."
        : "Authorization expired; verifier proof of no external payment is still required.",
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
        externalBridge: v.externalBridge, externalTxHash: nonzeroHash(v.externalTxHash),
        externalAccount: v.externalSender, externalToken: v.representationToken, externalAmount: String(v.stratoTokenAmount),
        ...(source === "native" ? { refundRecipient: v.externalSender, refundToken: v.representationToken, refundAmount: String(v.stratoTokenAmount), refundBridge: v.externalBridge, refundRedemptionId: String(v.externalRedemptionId) } : {}),
        scenario: source === "legacy" ? "Legacy deposit review" : evidence ? "Redemption refund confirmation"
          : refunding ? "Redemption refund in progress" : recovery ? "Redemption recovery decision" : "Redemption evidence review",
        reason: evidence ? "Verify the confirmed external representation refund."
          : refunding ? "The bridge is restoring the external representation."
          : recovery ? "Choose verified STRATO delivery, an external representation refund, or rejection when no burn occurred."
          : "Verify whether the external representation was burned and choose its disposition.",
        actions: source === "native" ? refunding ? evidence ? ["confirm_refund"] : [] : recovery ? ["approve", "refund", "reject"] : ["refund", "reject"] : [],
        ...(evidence ? { refundEvidenceHash: evidence } : {}),
        ...(!evidence && refunding && nonzeroHash(v.refundProposalHash) ? { safeProposalHash: nonzeroHash(v.refundProposalHash) } : {}),
      });
    }
    for (const row of withdrawals) {
      const v = row.value;
      if (source === "native" && String(v.bridgeStatus) === String(ExternalBridgeStatus.CANCELLATION_PENDING)) {
        const evidence = /^(0x)?[a-f0-9]{64}$/i.test(v.cancellationTxHash || "") ? nonzeroHash(v.cancellationTxHash) : undefined;
        items.push({ id: `native:withdrawal:${row.key}`, source, kind: "withdrawal_cancellation",
          chainId: String(v.externalChainId), reference: String(row.key), token: v.stratoToken,
          amount: String(v.stratoTokenAmount), account: v.stratoSender, refundBridge: v.externalBridge,
          externalBridge: v.externalBridge,
          externalAccount: v.externalRecipient, externalToken: v.representationToken, externalAmount: String(v.externalTokenAmount),
          scenario: evidence ? "Withdrawal cancellation refund" : "Withdrawal mint cancellation",
          reason: evidence ? "The external mint cancellation is ready for independent verification."
            : "The external mint identity must be canceled before STRATO escrow can be returned.",
          ...(evidence ? { refundEvidenceHash: evidence } : {}),
          ...(nonzeroHash(v.cancellationProposalHash) ? { safeProposalHash: nonzeroHash(v.cancellationProposalHash) } : {}),
          actions: evidence ? ["confirm_cancellation"] : [],
        });
        continue;
      }
      const proposal = nonzeroHash(source === "native" ? v.nativeMintProposalHash : v.custodyTxHash);
      const instant = source === "native" && (v.useInstantPath === true || String(v.useInstantPath) === "true");
      items.push({ id: `${source}:withdrawal:${row.key}`, source, kind: "withdrawal_review",
        chainId: String(v.externalChainId), reference: String(row.key), token: v.stratoToken,
        amount: String(v.stratoTokenAmount), account: v.stratoSender,
        externalBridge: v.externalBridge, externalTxHash: nonzeroHash(v.externalTxHash),
        externalAccount: v.externalRecipient, externalToken: v.representationToken, externalAmount: String(v.externalTokenAmount),
        scenario: source === "legacy" ? "Legacy withdrawal review" : instant ? "Blocked instant withdrawal" : "Manual withdrawal Safe approval",
        reason: instant ? "Instant verifier approval is unavailable; governance cancellation is available."
          : proposal ? "The external mint proposal is ready in Safe." : "The bridge service is preparing the external mint proposal.",
        ...(source === "native" ? { useInstantPath: instant } : {}),
        ...(proposal ? { safeProposalHash: proposal } : {}), actions: source === "native" ? ["cancel_withdrawal"] : [],
      });
    }
  }
  return items;
};
