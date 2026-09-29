import { ProcessingRecord } from "../types";
import sgMail from "@sendgrid/mail";
import { config } from "../config";
import { retry } from "../utils/api";
import type { BridgeReviewItem } from "@strato/shared-types";

sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

export const sendBridgeReviewEmail = async (item: BridgeReviewItem, resolved = false): Promise<void> => {
  const recipients = config.email.approverEmails;
  if (!recipients.length) throw new Error("TRANSACTION_APPROVER_EMAILS is required for bridge review notifications");
  const event = resolved ? "No longer awaiting review" : "Action required";
  await retry(() => sgMail.send({
    to: recipients, from: "info@blockapps.net",
    subject: `Bridge ${event.toLowerCase()}: ${item.source.toUpperCase()} ${item.kind.replace(/_/g, " ")} ${item.reference}`,
    text: [event, `Reference: ${item.id}`, `Network: ${item.chainId}`, `Account: ${item.account}`,
      `Token: ${item.token}`, `Amount (raw units): ${item.amount}`,
      resolved ? "Check the transaction history for its final outcome." : item.reason,
      ...(item.safeProposalHash ? [`Safe proposal: ${item.safeProposalHash}`] : []),
      item.kind === "withdrawal_review" ? "Review in Safe." : "Review in Admin > Bridge.",
    ].join("\n"),
  }), { logPrefix: "BridgeReviewEmail" });
};

export const sendProcessingIssueEmail = async (
  records: ProcessingRecord[], resolved: boolean,
): Promise<void> => {
  if (!config.email.approverEmails.length) throw new Error("TRANSACTION_APPROVER_EMAILS is required");
  const record = records[0];
  const event = resolved ? "Processing issue cleared" : "Processing issue requires attention";
  await sgMail.send({
    to: config.email.approverEmails, from: "info@blockapps.net",
    subject: `Bridge: ${event} (${record.context.source}, chain ${record.context.chainId})`,
    text: [event, `Affected operations: ${records.length}`, `First observed: ${new Date(record.firstSeenAt).toISOString()}`,
      ...records.slice(0, 20).flatMap(r => [`Reference: ${r.context.reference}; stage: ${r.context.stage}; token: ${r.context.token || "unknown"}`,
        ...r.issues.map(i => [resolved ? `Cleared issue: ${i.code}` : `${i.code}: ${i.message}`,
          ...(Object.keys(i.details).length ? [`${resolved ? "Previous diagnostics: " : ""}${JSON.stringify(i.details)}`] : [])].join("\n"))]),
      resolved ? "The reported blocker is no longer active. Processing may still be in progress; check transaction history for the final outcome."
        : `Next retry: ${new Date(record.nextRetryAt).toISOString()}. Amounts are raw integer units unless stated otherwise.`,
    ].join("\n"),
  });
};
