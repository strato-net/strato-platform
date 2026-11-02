import { BridgeEmailToken, ProcessingRecord } from "../types";
import sgMail from "@sendgrid/mail";
import { formatUnits, Network } from "ethers";
import { config, PROCESSING_EMAIL_CONTENT } from "../config";
import { retry } from "../utils/api";
import type { BridgeReviewItem } from "@strato/shared-types";
import { getBridgeEmailTokens } from "./cirrusService";

sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

const tokenKey = (address: string) => address.toLowerCase().replace(/^0x/i, "");
const networkLabel = (chainId: string) => {
  try {
    const name = Network.from(BigInt(chainId)).name;
    if (name !== "unknown") return `${name} (chain ${chainId})`;
  } catch { /* Preserve the chain ID when network metadata is unavailable. */ }
  return `Chain ${chainId}`;
};
const tokenMetadata = (addresses: string[]) => getBridgeEmailTokens(addresses).catch(() => new Map<string, BridgeEmailToken>());
const tokenAmount = (amount: string, asset?: BridgeEmailToken) => {
  try {
    if (asset?.decimals != null && /^\d+$/.test(amount)) return `${formatUnits(amount, asset.decimals)} ${asset.symbol}`;
  } catch { /* Unsupported metadata must not prevent delivery. */ }
  return `${amount} (raw token units; decimals unavailable)`;
};
const processingContent = (issue: ProcessingRecord["issues"][number]) => {
  const reason = issue.details.reason;
  const verifierQuorum = reason?.match(/native verifier quorum unavailable: received (\d+), require (\d+)/i);
  if (verifierQuorum) {
    return {
      title: "Native verifier quorum unavailable",
      observation: `The bridge received ${verifierQuorum[1]} of ${verifierQuorum[2]} required native-verifier signatures. No Safe mint proposal has been created yet.`,
      action: "Check native-verifier health, signer authorization, and native token policies for this chain. After quorum is restored, scheduled processing will create the Safe proposal and send a separate review notification.",
    };
  }
  if (issue.code === "UNKNOWN" && reason && /nonce=\d+.*safe=.*already executed/i.test(reason)) {
    return {
      title: "Safe proposal nonce was already used",
      observation: `The saved Safe proposal cannot execute because ${reason}.`,
      action: "Confirm the bridge runtime replaced the saved proposal at the Safe's current nonce. If no replacement proposal appears, inspect the bridge runtime and Safe service logs.",
    };
  }
  return PROCESSING_EMAIL_CONTENT[issue.code] || PROCESSING_EMAIL_CONTENT.UNKNOWN;
};
const detailLines = (details: Record<string, string>) => Object.entries(details).map(([key, value]) =>
  `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase())}: ${value}`);

export const sendBridgeReviewEmail = async (item: BridgeReviewItem): Promise<void> => {
  const recipients = config.email.approverEmails;
  if (!recipients.length) throw new Error("TRANSACTION_APPROVER_EMAILS is required for bridge review notifications");
  const asset = (await tokenMetadata([item.token])).get(tokenKey(item.token));
  const amount = tokenAmount(item.amount, asset);
  const title = item.kind === "withdrawal_cancellation" ? "Withdrawal cancellation" : item.kind === "deposit_recovery" ? "Deposit recovery" : item.kind === "deposit_review" ? "Deposit review" : item.kind === "withdrawal_refund" ? "Withdrawal refund" : "Withdrawal review";
  const action = item.kind === "withdrawal_cancellation" ? item.refundEvidenceHash
    ? "Open Admin > Bridge. Independently verify permanent external mint cancellation and its confirmations, then vote to return STRATO escrow. The operator report alone is not proof."
    : "Safe signers: execute the mint cancellation proposal. Reject any older mint proposal blocking its nonce first. Funds remain locked until cancellation is verified."
    : item.refundEvidenceHash ? "Open Admin > Bridge. Independently verify the external refund transaction and vote to confirm the refund. The operator report alone is not proof of payment."
    : item.kind === "withdrawal_review" || (item.recoveryStatus === "refund_pending" && item.safeProposalHash) ? "Review in Safe. Inspect and vote on the proposal shown below."
    : item.kind === "withdrawal_refund" ? "Open Admin > Bridge to review and vote on this refund."
    : "Open Admin > Bridge and review the deposit evidence.";
  const explanation = item.kind === "withdrawal_refund"
    ? "The withdrawal authorization expired. The required verifier attestations for a refund are now indexed."
    : item.reason;
  await retry(() => sgMail.send({
    to: recipients, from: "info@blockapps.net",
    subject: `Bridge: Action required — ${title.toLowerCase()} #${item.reference} (${item.source.toUpperCase()})`,
    text: [`${title} #${item.reference}`, "", "What happened", explanation, "",
      "Action required", action,
      "", "Transfer", `Bridge: ${item.source.toUpperCase()}`, `Network: ${networkLabel(item.chainId)}`,
      `Asset: ${asset?.symbol || "Token metadata unavailable"}`, `Amount: ${amount}`,
      "", "Reference details", `Reference: ${item.id}`, `Account: ${item.account}`, `Token address: ${item.token}`,
      ...(item.recoveryStatus === "refund_pending" ? [`Return to: ${item.refundRecipient}`, `Original asset: ${item.refundToken}`, `Original amount (raw units): ${item.refundAmount}`] : []),
      ...(item.refundEvidenceHash ? [`External transaction to verify: ${item.refundEvidenceHash}`, `External bridge: ${item.refundBridge}`, `${item.kind === "withdrawal_cancellation" ? "Withdrawal" : "Redemption"} ID: ${item.kind === "withdrawal_cancellation" ? item.reference : item.refundRedemptionId}`] : []),
      ...(item.safeProposalHash ? [`Safe proposal: ${item.safeProposalHash}`] : []),
      ...(item.reviewDigest ? [`Review digest: ${item.reviewDigest}`] : []),
    ].join("\n"),
  }), { logPrefix: "BridgeReviewEmail" });
};

export const sendProcessingIssueEmail = async (
  records: ProcessingRecord[], resolved: boolean,
): Promise<void> => {
  if (!config.email.approverEmails.length) throw new Error("TRANSACTION_APPROVER_EMAILS is required");
  const record = records[0];
  const displayed = records.slice(0, 20);
  const tokens = await tokenMetadata(displayed.flatMap(r => r.context.token ? [r.context.token] : []));
  const contents = [...new Map(records.flatMap(r => r.issues.map(issue => {
    const content = processingContent(issue);
    return [content.title, content] as const;
  }))).values()];
  const titles = [...new Set(contents.map(content => content.title))];
  const event = resolved ? "Previously reported issue resolved" : "Operations check needed";
  await sgMail.send({
    to: config.email.approverEmails, from: "info@blockapps.net",
    subject: `Bridge: ${event} — ${resolved ? `reference ${record.context.reference}` : titles.length === 1 ? titles[0] : "multiple processing issues"} (${record.context.source.toUpperCase()}, chain ${record.context.chainId})`,
    text: [event, "", resolved ? "Original issue" : "What we observed",
      ...(resolved ? titles : contents.map(content => content.observation || content.title)),
      ...(resolved ? [] : ["", "Who acts next", "Platform operations team.", "", "Next steps"]),
      ...(resolved ? ["", "What this means"] : []),
      ...(resolved ? ["The previously reported blocker is no longer active. No further action is needed for that blocker.",
        "Processing may still be in progress or require a separate governance review. Check transaction history for the final outcome."]
        : contents.map(content => content.action)),
      ...(resolved ? [] : ["", "Automatic processing", "The bridge continues scheduled retries. The user should not resubmit the transfer.",
        "This email requests an operations check, not an admin vote. For transaction approval or refund votes, follow the separate governance review notification."]),
      "", "Affected transfers", `Operations: ${records.length}`, `Network: ${networkLabel(record.context.chainId)}`,
      ...displayed.flatMap(r => [
        `${r.context.stage.startsWith("deposit") ? "Deposit" : "Withdrawal"} #${r.context.reference.split(":").at(-1)} — ${tokens.get(tokenKey(r.context.token || ""))?.symbol || "token metadata unavailable"}`,
        ...r.issues.filter(i => i.code === "INDEXING_PENDING" && /^\d+$/.test(i.details.available || "") && /^\d+$/.test(i.details.required || ""))
          .map(i => `${resolved ? "Previously observed" : "Verifier confirmations visible in Cirrus"}: ${i.details.available} of ${i.details.required}`),
      ]),
      ...(records.length > displayed.length ? [`${records.length - displayed.length} additional operations are recorded in the service journal.`] : []),
      "", "Technical details", `First reported: ${new Date(record.firstSeenAt).toISOString()}`,
      ...displayed.flatMap(r => [`Reference: ${r.context.reference}`, `Stage: ${r.context.stage.replace(/-/g, " ")}`,
        `Token address: ${r.context.token || "unavailable"}`,
        ...r.issues.flatMap(i => [`${resolved ? "Previous issue code" : "Issue code"}: ${i.code}`, ...detailLines(i.details)]), ""]),
      ...(resolved ? [] : [`Next scheduled retry: ${new Date(record.nextRetryAt).toISOString()}.`, "Diagnostic amounts are raw integer units unless labeled otherwise."]),
    ].join("\n"),
  });
};
