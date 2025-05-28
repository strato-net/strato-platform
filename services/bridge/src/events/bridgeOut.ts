import axios from "axios";
import logger from "../utils/logger";
import { config } from "../config";

import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";




interface BridgeOutTransaction {
  hash: string;
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
    console.log("🚀 Starting BRIDGE-OUT flow (STRATO to ETH)...");
    const { hash, value, to, from, token, accessToken } = transaction;

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
      console.error("Amount formatting error:", error);
      throw new Error("Invalid amount format. Please provide a valid number");
    }

    console.log("Formatted amount:", amount.toString());

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
              token: strip0xPrefix(token),
              from: strip0xPrefix(config.bridge.address),
              amount: amount.toString(),
              ethRecipient: formatAddress(to).replace("0x", ""),
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

    console.log("🧾 Full txPayload:", JSON.stringify(txPayload, null, 2));

    const response = await axios.post(
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

    console.log("Contract Response:", response.data);

    if (response.data && response.data[0].hash) {
      console.log("Transaction submitted with hash:", response.data[0].hash);
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

    console.log("Event Response:", eventResponse.data);

    const matchingEvent = eventResponse.data.find(
      (event: any) => event.transaction_hash === response.data[0].hash
    );

    if (matchingEvent) {
      console.log("Matching event found:", matchingEvent);

      const apiKit = new SafeApiKit({
        chainId: 11155111n,
      });

      const protocolKitOwner1 = await Safe.init({
        provider: config.ethereum.rpcUrl || "",
        signer: config.safe.safeOwnerPrivateKey || "",
        safeAddress: config.safe.address || "",
      });

      const safeTransactionData: MetaTransactionData = {
        to: formatAddress(to).replace("0x", ""),
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

      const signature = await protocolKitOwner1.signHash(safeTxHash);

      await apiKit.proposeTransaction({
        safeAddress: config.safe.address || "",
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: config.safe.safeOwnerAddress || "",
        senderSignature: signature.data,
      });

      console.log("Safe transaction proposed successfully");
    } else {
      console.log("No matching event found for transaction hash:", response.data[0].hash);
    }
  } catch (error: any) {
    console.error("Error in handleBridgeOut:", error?.message);
    if (error.response) {
      console.error("API Error Response:", error.response.data);
      console.error("API Error Status:", error.response.status);
    }
    throw error;
  }
}
