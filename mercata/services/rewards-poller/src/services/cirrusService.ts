import { cirrus } from "../utils/api";
import { ProtocolEvent } from "../types";
import { logError } from "../utils/logger";

const MERCATA_PREFIX = "BlockApps-Mercata";

export const getEventsByContractAndName = async (
  contractName: string,
  eventName: string,
  lastProcessedBlock?: number,
): Promise<ProtocolEvent[]> => {
  try {
    const params: Record<string, any> = {
      select: "*",
      order: "blockNumber.asc",
    };

    if (lastProcessedBlock !== undefined) {
      params["blockNumber"] = `gt.${lastProcessedBlock}`;
    }

    const data = await cirrus.get(`/${MERCATA_PREFIX}-${contractName}-${eventName}`, {
      params,
    });

    if (!Array.isArray(data) || !data.length) return [];

    return data.map((item: any) => {
      const value = item.value || item;
      return {
        contractName,
        eventName,
        user: value.user || value.userAddress || "",
        amount: value.amount?.toString() || value.amountIn?.toString() || "0",
        blockNumber: value.blockNumber || item.blockNumber,
        txHash: value.txHash || item.txHash,
        timestamp: value.timestamp || item.timestamp,
      };
    });
  } catch (error) {
    logError("CirrusService", error as Error, {
      operation: "getEventsByContractAndName",
      contractName,
      eventName,
    });
    return [];
  }
};

export const getPoolDepositedEvents = async (
  lastProcessedBlock?: number,
): Promise<ProtocolEvent[]> => {
  return getEventsByContractAndName("Pool", "Deposited", lastProcessedBlock);
};

export const getPoolWithdrawnEvents = async (
  lastProcessedBlock?: number,
): Promise<ProtocolEvent[]> => {
  return getEventsByContractAndName("Pool", "Withdrawn", lastProcessedBlock);
};

export const getLiquidityPoolDepositedEvents = async (
  lastProcessedBlock?: number,
): Promise<ProtocolEvent[]> => {
  return getEventsByContractAndName("LiquidityPool", "Deposited", lastProcessedBlock);
};

export const getLiquidityPoolWithdrawnEvents = async (
  lastProcessedBlock?: number,
): Promise<ProtocolEvent[]> => {
  return getEventsByContractAndName("LiquidityPool", "Withdrawn", lastProcessedBlock);
};

export const getLendingPoolBorrowedEvents = async (
  lastProcessedBlock?: number,
): Promise<ProtocolEvent[]> => {
  return getEventsByContractAndName("LendingPool", "Borrowed", lastProcessedBlock);
};

export const getLendingPoolRepaidEvents = async (
  lastProcessedBlock?: number,
): Promise<ProtocolEvent[]> => {
  return getEventsByContractAndName("LendingPool", "Repaid", lastProcessedBlock);
};

