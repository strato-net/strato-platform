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
const processingContent = (code: keyof typeof PROCESSING_EMAIL_CONTENT) => PROCESSING_EMAIL_CONTENT[code] || PROCESSING_EMAIL_CONTENT.UNKNOWN;
const detailLines = (details: Record<string, string>) => Object.entries(details).map(([key, value]) =>
  `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase())}: ${value}`);

export const sendBridgeReviewEmail = async (item: BridgeReviewItem, resolved = false): Promise<void> => {
  const recipients = config.email.approverEmails;
  if (!recipients.length) throw new Error("TRANSACTION_APPROVER_EMAILS is required for bridge review notifications");
  const asset = (await tokenMetadata([item.token])).get(tokenKey(item.token));
  const amount = tokenAmount(item.amount, asset);
  const title = item.kind === "deposit_recovery" ? "Deposit recovery" : item.kind === "deposit_review" ? "Deposit review" : item.kind === "withdrawal_refund" ? "Withdrawal refund" : "Withdrawal review";
  const action = item.refundEvidenceHash ? "Open Admin > Bridge. Independently verify the external refund transaction and vote to confirm the refund. The operator report alone is not proof of payment."
    : item.kind === "withdrawal_review" || (item.recoveryStatus === "refund_pending" && item.safeProposalHash) ? "Review in Safe. Inspect and vote on the proposal shown below."
    : item.kind === "withdrawal_refund" ? "Open Admin > Bridge to review and vote on this refund."
    : "Open Admin > Bridge and review the deposit evidence.";
  if (resolved && !item.outcome && item.approvalStatus !== "approved") throw new Error("Review resolution requires a confirmed outcome");
  const explanation = resolved
    ? item.approvalStatus === "approved" ? "Governance approval is recorded. The bridge will retry settlement automatically."
      : item.outcome === "refunded" ? "The bridge records that the funds were returned to the sender."
        : "The bridge records that delivery completed."
    : item.kind === "withdrawal_refund" ? "The withdrawal authorization expired. The required verifier attestations for a refund are now indexed."
      : item.reason;
  await retry(() => sgMail.send({
    to: recipients, from: "info@blockapps.net",
    subject: `Bridge: ${resolved ? item.approvalStatus === "approved" ? "Approval recorded; settlement pending" : item.outcome === "refunded" ? "Refund confirmed" : "Transfer completed" : "Action required"} — ${title.toLowerCase()} #${item.reference} (${item.source.toUpperCase()})`,
    text: [`${title} #${item.reference}`, "", "What happened", explanation, "",
      resolved ? "Next step" : "Action required",
      resolved ? item.approvalStatus === "approved" ? "No further approval is needed. This is not confirmation that funds were transferred."
        : "No further recovery action is needed for this transfer." : action,
      "", "Transfer", `Bridge: ${item.source.toUpperCase()}`, `Network: ${networkLabel(item.chainId)}`,
      `Asset: ${asset?.symbol || "Token metadata unavailable"}`, `Amount: ${amount}`,
      "", "Reference details", `Reference: ${item.id}`, `Account: ${item.account}`, `Token address: ${item.token}`,
      ...(item.recoveryStatus === "refund_pending" ? [`Return to: ${item.refundRecipient}`, `Original asset: ${item.refundToken}`, `Original amount (raw units): ${item.refundAmount}`] : []),
      ...(item.refundEvidenceHash ? [`External refund transaction to verify: ${item.refundEvidenceHash}`, `External bridge: ${item.refundBridge}`, `Redemption ID: ${item.refundRedemptionId}`] : []),
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
  const titles = [...new Set(records.flatMap(r => r.issues.map(i => processingContent(i.code).title)))];
  const event = resolved ? "Previously reported issue resolved" : "Action required";
  await sgMail.send({
    to: config.email.approverEmails, from: "info@blockapps.net",
    subject: `Bridge: ${event} — ${resolved ? `reference ${record.context.reference}` : titles.length === 1 ? titles[0] : "multiple processing issues"} (${record.context.source.toUpperCase()}, chain ${record.context.chainId})`,
    text: [event, "", resolved ? "Original issue" : "What happened", ...titles,
      "", resolved ? "What this means" : "Action required",
      ...(resolved ? ["The previously reported blocker is no longer active. No further action is needed for that blocker.",
        "Processing may still be in progress or require a separate governance review. Check transaction history for the final outcome."]
        : [...new Set(records.flatMap(r => r.issues.map(i => processingContent(i.code).action)))]),
      "", "Affected transfers", `Operations: ${records.length}`, `Network: ${networkLabel(record.context.chainId)}`,
      ...displayed.map(r => `${r.context.stage.startsWith("deposit") ? "Deposit" : "Withdrawal"} #${r.context.reference.split(":").at(-1)} — ${tokens.get(tokenKey(r.context.token || ""))?.symbol || "token metadata unavailable"}`),
      ...(records.length > displayed.length ? [`${records.length - displayed.length} additional operations are recorded in the service journal.`] : []),
      "", "Technical details", `First reported: ${new Date(record.firstSeenAt).toISOString()}`,
      ...displayed.flatMap(r => [`Reference: ${r.context.reference}`, `Stage: ${r.context.stage.replace(/-/g, " ")}`,
        `Token address: ${r.context.token || "unavailable"}`,
        ...r.issues.flatMap(i => [`${resolved ? "Previous issue code" : "Issue code"}: ${i.code}`, ...detailLines(i.details)]), ""]),
      ...(resolved ? [] : [`Next scheduled retry: ${new Date(record.nextRetryAt).toISOString()}.`, "Diagnostic amounts are raw integer units unless labeled otherwise."]),
    ].join("\n"),
  });
};
