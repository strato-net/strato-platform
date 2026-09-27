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
