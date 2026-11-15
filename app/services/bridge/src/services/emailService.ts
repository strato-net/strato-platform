import axios from "axios";
import { config } from "../config";
import { retry } from "../utils/api";

const getSafeChainIdentifier = (chainId: number | string): string => {
  const chainIdNum = typeof chainId === "string" ? parseInt(chainId, 10) : chainId;
  const chainMap: Record<number, string> = {
    1: "eth",
    8453: "base",
    11155111: "sep",
    59144: "linea",
    84532: "basesep",
    4663: "robinhood",
    46630: "robinhood-testnet",
  };
  return chainMap[chainIdNum] || `chain-${chainIdNum}`;
};

const sendEmail = async (safeTxHash: string, chainId: number | string) => {
  const emailAddresses = process.env.TRANSACTION_APPROVER_EMAILS?.split(
    ",",
  ).map((email) => email.trim());
  const safeAddress = config.safe.address;
  const chainIdentifier = getSafeChainIdentifier(chainId);

  const safeTxLink = `https://app.safe.global/transactions/tx?safe=${chainIdentifier}:${safeAddress}&id=multisig_${safeAddress}_${safeTxHash}`;

  await retry(
    () =>
      axios.post(
        "https://api.sendgrid.com/v3/mail/send",
        {
          personalizations: [
            { to: (emailAddresses || []).map((email) => ({ email })) },
          ],
          from: { email: "info@blockapps.net" },
          subject: "New Bridge Transaction Proposed and Pending Approval",
          content: [
            {
              type: "text/plain",
              value: `Please review and approve the transaction: ${safeTxLink}`,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.SENDGRID_API_KEY || ""}`,
          },
        },
      ),
    { logPrefix: "EmailService" }
  );
};

export default sendEmail;
