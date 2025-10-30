import sgMail from "@sendgrid/mail";
import { MailDataRequired } from "@sendgrid/mail";
import { config } from "../config";
import { retry } from "../utils/api";

sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

const sendEmail = async (txHash: string) => {
  const emailAddresses = process.env.TRANSACTION_APPROVER_EMAILS?.split(
    ",",
  ).map((email) => email.trim());
  const safeAddress = config.safe.address;

  const safeTxLink = `https://app.safe.global/transactions/tx?safe=sep:${safeAddress}&id=multisig_${safeAddress}_${txHash}`;

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
