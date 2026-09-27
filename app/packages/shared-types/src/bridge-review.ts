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
    items.push({ id: `eab:deposit:${row.key}:${row.key2}:${row.key3}`, source: "eab", kind: "deposit_review",
      chainId: String(row.key), reference: String(row.key3), token: v.stratoToken,
      amount: String(v.stratoTokenAmount), account: v.stratoRecipient,
      reason: "Review the external deposit evidence. Approval authorizes settlement; rejecting does not return external funds.",
      actions: ["approve", "reject", "settle"],
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
      items.push({ id: `${source}:deposit:${row.key}:${row.key2 || ""}`, source, kind: "deposit_review",
        chainId: String(v.externalChainId || row.key), reference: String(row.key2 || row.key),
        token: v.stratoToken, amount: String(v.stratoTokenAmount), account: v.stratoRecipient,
        reason: "Operator evidence review is required. Do not override failed custody verification or treat cancellation as an external refund.", actions: [],
      });
    }
    for (const row of withdrawals) {
      const v = row.value;
      const proposal = nonzeroHash(source === "native" ? v.nativeMintProposalHash : v.custodyTxHash);
      items.push({ id: `${source}:withdrawal:${row.key}`, source, kind: "withdrawal_review",
        chainId: String(v.externalChainId), reference: String(row.key), token: v.stratoToken,
        amount: String(v.stratoTokenAmount), account: v.stratoSender,
        reason: proposal ? "Review and execute the Safe proposal to proceed." : "The bridge operator is preparing the Safe proposal.",
        ...(proposal ? { safeProposalHash: proposal } : {}), actions: [],
      });
    }
  }
  return items;
};
