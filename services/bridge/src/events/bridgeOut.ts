import axios from "axios";
import logger from "../utils/logger";
import { config } from "../config";
import sgMail from '@sendgrid/mail';

import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');


const BLOCKAPPS_EMAIL = process.env.BLOCKAPPS_EMAIL ;

interface BridgeOutTransaction {
  value: string;
  to?: string;
  from?: string;
  token?: string;
  accessToken: string;
}

const nodeUrl = process.env.NODE_URL

export async function handleBridgeOut(
  transaction: BridgeOutTransaction
): Promise<void> {
  try {
    logger.info("🚀 Starting BRIDGE-OUT flow (STRATO to ETH)...");
    const {  value, to, from, token, accessToken } = transaction;

    // Validate input parameters
    if (!token) throw new Error("Token address is required for withdrawal");
    if (!from) throw new Error("From address is required for withdrawal");
    if (!to) throw new Error("To address (ethRecipient) is required for withdrawal");
    if (!value) throw new Error("Value is required for withdrawal");

    // Format and validate the amount
    let amount: bigint;
    try {
      // Remove any whitespace and ensure it's a string
      const cleanValue = value.toString().trim();
      // Check if the value is a valid number
      if (isNaN(Number(cleanValue))) {
        throw new Error("Value must be a valid number");
      }

      // Convert to BigInt, handling both integer and decimal values
      amount = BigInt(Math.floor(Number(cleanValue) * 1e18));
      
      if (amount <= 0n) {
        throw new Error("Amount must be greater than 0");
      }
    } catch (error) {
      logger.error("Amount formatting error:", error);
      throw new Error("Invalid amount format. Please provide a valid number");
    }

   

    const formatAddress = (addr: string): string => {
      const lower = addr.toLowerCase();
      return lower.startsWith("0x") ? lower : `0x${lower}`;
    };

    const strip0xPrefix = (value: string): string => {
      return value.startsWith("0x") ? value.slice(2) : value;
    };

    if (!config.safe.address) {
      throw new Error("Safe address is not configured");
    }

    if (!config.bridge.address) {
      throw new Error("Bridge address is not configured");
    }

    const txPayload = {
      txs: [
        {
          payload: {
            contractName: "BridgeContract",
            contractAddress: config.bridge.address,
            method: "withdraw",
            args: {
              txHash: 'fdxcghgvhmbmh'.toString().replace("0x", ""),
              token: strip0xPrefix(token),
              from: strip0xPrefix('0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce'),
              amount: amount.toString(),
              ethRecipient: formatAddress(to).replace("0x", ""),
              mercataUser: formatAddress(to).replace("0x", ""),
            },
          },
          type: "FUNCTION",
        },
      ],
      txParams: {
        gasLimit: 150000,
        gasPrice: 30000000000,
      },
    };

    // console.log("txPayload", txPayload);

    logger.info("🧾 Full txPayload:", JSON.stringify(txPayload, null, 2));

    // console.log("accessToken", accessToken);

    let response: any;

    try{
      response = await axios.post(
        `${nodeUrl}/strato/v2.3/transaction/parallel?resolve=true`,
        txPayload,
        {
          headers: {
            accept: "application/json;charset=utf-8",
            "content-type": "application/json;charset=utf-8",
            authorization: `Bearer ${accessToken}`,
          },
        }
      );
      // console.log("Contract Response:", response.data);
    }catch(e){
      console.log("Contract Response:", e);
    }

    // console.log("Contract Response:", response.data);

    logger.info("Contract Response:", response.data);

    if (response.data && response.data[0].hash) {
      logger.info("Transaction submitted with hash:", response.data[0].hash);
    } else {
      throw new Error("Transaction submission failed");
    }

    const eventResponse = await axios.get(
      `${nodeUrl}/cirrus/search/MercataEthBridge.WithdrawalInitiated`,
      {
        headers: {
          accept: "application/json;charset=utf-8",
          "content-type": "application/json;charset=utf-8",
          authorization: `Bearer ${accessToken}`,
        },
      }
    );

  

    const matchingEvent = eventResponse.data.find(
      (event: any) => event.transaction_hash === response.data[0].hash
    );

    if (matchingEvent) {
      logger.info("Matching event found:", matchingEvent);

      const apiKit = new SafeApiKit({
        chainId: 11155111n,
      });

      const protocolKitOwner1 = await Safe.init({
        provider: config.ethereum.rpcUrl || "",
        signer: config.safe.safeOwnerPrivateKey || "",
        safeAddress: config.safe.address || "",
      });

      const safeTransactionData: MetaTransactionData = {
        to: to,
        value: amount.toString(),
        data: "0x",
        operation: OperationType.Call,
      };

      const safeTransaction = await protocolKitOwner1.createTransaction({
        transactions: [safeTransactionData],
      });

      const safeTxHash = await protocolKitOwner1.getTransactionHash(
        safeTransaction
      );

      // console.log("safeTxHash", safeTxHash);

      const signature = await protocolKitOwner1.signHash(safeTxHash);

      await apiKit.proposeTransaction({
        safeAddress: config.safe.address || "",
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: config.safe.safeOwnerAddress || "",
        senderSignature: signature.data,
      });
      
      logger.info("Safe transaction proposed successfully");

      // Call markPendingApproval
      const markPendingTxPayload = {
        txs: [
          {
            payload: {
              contractName: "BridgeContract",
              contractAddress: config.bridge.address,
              method: "markWithdrawalPendingApproval",
              args: {
                txHash: safeTxHash.toString().replace("0x", ""),
              },
            },
            type: "FUNCTION",
          },
        ],
        txParams: {
          gasLimit: 150000,
          gasPrice: 30000000000,
        },
      };

      const markPendingResponse = await axios.post(
        `${nodeUrl}/strato/v2.3/transaction/parallel?resolve=true`,
        markPendingTxPayload,
        {
          headers: {
            accept: "application/json;charset=utf-8",
            "content-type": "application/json;charset=utf-8",
            authorization: `Bearer ${accessToken}`,
          },
        }
      );

    



      if (markPendingResponse.data && markPendingResponse.data[0].hash) {
        logger.info("MarkPendingApproval transaction submitted with hash:", markPendingResponse.data[0].hash);
        
        // Send email notification only after both transactions are successful
        try {
          if (!BLOCKAPPS_EMAIL) {
            logger.error('BLOCKAPPS_EMAIL environment variable is not set');
            return;
          }

          // Split email addresses and trim whitespace
          const emailAddresses = BLOCKAPPS_EMAIL.split(',').map(email => email.trim());

          // Create email message
          const msg = {
            to: emailAddresses, // SendGrid will handle multiple recipients
            from: emailAddresses[0], // Use first email as sender
            subject: 'New Bridge Transaction Proposed and Pending Approval',
            html: `
              <h2>New Bridge Transaction Details</h2>
              <p><strong>Initial Transaction Hash:</strong> ${response.data[0].hash}</p>
              <p><strong>From Address:</strong> ${from}</p>
              <p><strong>To Address:</strong> ${to}</p>
              <p><strong>Amount:</strong> ${value} ${token}</p>
              <p><strong>Safe Transaction Hash:</strong> ${safeTxHash}</p>
              <p><strong>Mark Pending Approval Hash:</strong> ${markPendingResponse.data[0].hash}</p>
              <p><strong>Status:</strong> Pending Approval</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              <p>Please review and sign the transaction in the Safe interface.</p>
            `,
          };

          // Send email to all recipients
          await sgMail.send(msg);
          logger.info('Transaction notification email sent successfully to:', emailAddresses.join(', '));
        } catch (emailError) {
          logger.error('Failed to send email notification:', emailError);
          // Don't throw the error as email failure shouldn't affect the main flow
        }
      } else {
        throw new Error("MarkPendingApproval transaction submission failed");
      }
    } else {
      logger.info("No matching event found for transaction hash:", response.data[0].hash);
    }
  } catch (error: any) {
    logger.error("Error in handleBridgeOut:", error?.message);
    if (error.response) {
      logger.error("API Error Response:", error.response.data);
      logger.error("API Error Status:", error.response.status);
    }
    throw error;
  }
}
