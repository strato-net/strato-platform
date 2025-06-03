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
  from?: string;
  token?: string;
}

const nodeUrl = process.env.NODE_URL;

// Helper function to convert decimal string to BigInt
function convertDecimalToBigInt(decimalStr: string): bigint {
  try {
    // Remove any non-numeric characters except decimal point
    const cleanAmount = decimalStr.replace(/[^0-9.]/g, '');
    
    // Split into whole and decimal parts
    const [whole, decimal] = cleanAmount.split('.');
    
    if (!decimal) {
      return BigInt(whole);
    }

    // Convert to smallest unit (e.g., wei)
    const decimalPlaces = decimal.length;
    const multiplier = BigInt(10) ** BigInt(decimalPlaces);
    
    const wholePart = BigInt(whole) * multiplier;
    const decimalPart = BigInt(decimal.padEnd(decimalPlaces, '0'));
    
    return wholePart + decimalPart;
  } catch (error) {
    logger.error('Amount conversion error:', { decimalStr, error });
    throw new Error("Invalid amount format. Amount must be a valid number");
  }
}

export async function handleBridgeIn(
  transaction: BridgeInTransaction
): Promise<void> {
  try {
    console.log('handleBridgeIn function from alchemy socket flow');
    const { hash, value } = transaction;

    const receiverAddress = "0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce"; // 🔒 hardcoded

    // Convert amount to BigInt
    const amount = convertDecimalToBigInt(value);

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

    const txPayload = {
      txs: [
        {
          payload: {
            contractName: "BridgeContract",
            contractAddress: contractAddress.toLowerCase().replace("0x", ""),
            method: "confirmDeposit",
            args: {
              txHash: txHashNumber.toString().replace("0x", ""),
              token: tokenAddress.toLowerCase().replace("0x", ""),
              to: receiverAddress?.toLowerCase().replace("0x", ""),
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

    logger.info('Socket event payload:', txPayload);

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

    logger.info("HandleBridgeIn Contract  call successful", {
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

export async function handleBridgeInProposeTransaction(
  transaction: BridgeInTransaction
): Promise<void> {
  try {
    console.log('handleBridgeInProposeTransaction from api flow');
    const { hash, value, from, token } = transaction;

    // Convert amount to BigInt
    const amount = convertDecimalToBigInt(value);

    if (!token) {
      throw new Error("Token address is required");
    }

    const contractAddress = config.bridge.address;
    if (!contractAddress) {
      throw new Error("Bridge contract address not found in config");
    }

    // Convert hash to uint256 decimal string
    const txHashNumber = BigInt(hash.startsWith("0x") ? hash : `0x${hash}`);

    const receiverAddress = "0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce"; // 🔒 hardcoded

    const txPayload = {
      txs: [
        {
          payload: {
            contractName: "BridgeContract",
            contractAddress: contractAddress.toLowerCase().replace("0x", ""),
            method: "deposit",
            args: {
              from: from?.toLowerCase().replace("0x", ""),
              txHash: txHashNumber.toString().replace("0x", ""),
              token: token.toLowerCase().replace("0x", ""),
              to: receiverAddress.toLowerCase().replace("0x", ""),
              amount: amount.toString(),
              mercataUser: receiverAddress.toLowerCase().replace("0x", "")
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

    logger.info('Propose transaction payload:', txPayload);

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

    logger.info(" handleBridgeInProposeTransaction Contractsuccessful", {
      status: response.status,
      data: response.data,
    });

  } catch (error: any) {
    logger.error("❌ [CONTRACT] Bridge propose call failed", {
      status: error?.response?.status,
      message: error?.response?.statusText,
      data: error?.response?.data,
      request: error?.config?.data,
    });
    throw error;
  }
}
