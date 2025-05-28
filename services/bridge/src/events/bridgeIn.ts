import { config } from "../config";
import logger from "../utils/logger";
import axios from "axios";
import { getUserToken } from "../auth";

interface ERC20TransferLog {
  topics: string[];
  data: string;
  address: string;
  transactionHash: string;
  to?: string;
}

interface BridgeInTransaction {
  hash: string;
  value: string;
  tx?: ERC20TransferLog;
  to?: string;
}

const nodeUrl = process.env.NODE_URL;

export async function handleBridgeIn(
  transaction: BridgeInTransaction
): Promise<void> {
  try {
    const { hash, value } = transaction;

    const receiverAddress = "0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce"; // 🔒 hardcoded

    const amount = BigInt(value);

    const tokenAddress = config.bridge.tokenAddress;
    if (!tokenAddress) {
      throw new Error("Token address not found in config");
    }

    const contractAddress = config.bridge.address;
    if (!contractAddress) {
      throw new Error("Bridge contract address not found in config");
    }

    // Convert hash to uint256 decimal string
    const txHashNumber = BigInt(hash.startsWith("0x") ? hash : `0x${hash}`);

    // const txPayload = {
    //   txs: [
    //     {
    //       payload: {
    //         contractName: "BridgeContract",
    //         contractAddress,
    //         method: "recordDeposit",
    //         args: {
    //           ethTxHash: txHashNumber.toString(), // decimal string
    //           token: tokenAddress,
    //           to: receiverAddress,
    //           amount: amount.toString(),
    //         },
    //       },
    //       type: "FUNCTION",
    //     },
    //   ],
    //   txParams: {
    //     gasLimit: 150000,
    //     gasPrice: 30000000000,
    //   },
    // };

    const txPayload = {
      txs: [
        {
          payload: {
            contractName: "BridgeContract",
            contractAddress: contractAddress.toLowerCase(),
            method: "recordDeposit",
            args: {
              ethTxHash: txHashNumber.toString(),
              token: tokenAddress.toLowerCase(),
              to: receiverAddress.toLowerCase(),
              amount: amount.toString(),
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
    

    const accessToken = await getUserToken();
    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

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

    logger.info("✅ [CONTRACT] Bridge call successful", {
      status: response.status,
      data: response.data,
    });

  } catch (error: any) {
    logger.error("❌ [CONTRACT] Bridge call failed", {
      status: error?.response?.status,
      message: error?.response?.statusText,
      data: error?.response?.data,
      request: error?.config?.data,
    });
    throw error;
  }
}
