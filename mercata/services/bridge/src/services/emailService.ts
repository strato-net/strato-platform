import sgMail from "@sendgrid/mail";
import { MailDataRequired } from "@sendgrid/mail";
import { config } from "../config";
import { retry } from "../utils/api";

sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

const getSafeChainIdentifier = (chainId: number | string): string => {
  const chainIdNum = typeof chainId === "string" ? parseInt(chainId, 10) : chainId;
  const chainMap: Record<number, string> = {
    1: "eth",
    11155111: "sep",
  };
  return chainMap[chainIdNum] || `chain-${chainIdNum}`;
};

const sendEmail = async (txHash: string, chainId: number | string) => {
  const emailAddresses = process.env.TRANSACTION_APPROVER_EMAILS?.split(
    ",",
  ).map((email) => email.trim());
  const safeAddress = config.safe.address;
  const chainIdentifier = getSafeChainIdentifier(chainId);

  const safeTxLink = `https://app.safe.global/transactions/tx?safe=${chainIdentifier}:${safeAddress}&id=multisig_${safeAddress}_${txHash}`;

  const msg: MailDataRequired = {
    to: emailAddresses || [],
    from: "info@blockapps.net",
    subject: "New Bridge Transaction Proposed and Pending Approval",
    text: `Please review and approve the transaction: ${safeTxLink}`,
  };

  await retry(
    () => sgMail.send(msg),
    { logPrefix: "EmailService" }
  );
};

export default sendEmail;
