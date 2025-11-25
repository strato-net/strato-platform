import { cirrus } from "../utils/api";
import { ProtocolEvent, ActivityInfo, CirrusEvent } from "../types";
import { logError, logInfo } from "../utils/logger";
import { config } from "../config";

const MERCATA_PREFIX = "BlockApps-Mercata";

export const getRewardsActivities = async (): Promise<Map<string, ActivityInfo>> => {
  try {
    const data = await cirrus.get(`/${MERCATA_PREFIX}-Rewards-activities`, {
      params: {
        address: `eq.${config.rewards.address}`,
        select: "key,value",
      },
    });

    if (!Array.isArray(data) || !data.length) {
      logInfo("CirrusService", "No activities found in Rewards contract");
      return new Map();
    }

    const activities = new Map<string, ActivityInfo>();
    for (const item of data) {
      const activityId = Number(item.key);
      const value = item.value;
      const activityType = value.activityType === 0 || value.activityType === "Position" ? "Position" : "OneTime";
      
      activities.set(value.name, {
        activityId,
        name: value.name,
        activityType,
        emissionRate: value.emissionRate?.toString() || "0",
        allowedCaller: value.allowedCaller,
      });
    }

    logInfo("CirrusService", `Loaded ${activities.size} activities from Rewards contract`);
    return activities;
  } catch (error) {
    logError("CirrusService", error as Error, {
      operation: "getRewardsActivities",
    });
    return new Map();
  }
};

const extractUserFromAttributes = (attributes: Record<string, any>): string => {
  return attributes.user || 
         attributes.userAddress || 
         attributes.from || 
         attributes.sender || 
         "";
};

const extractAmountFromAttributes = (attributes: Record<string, any>): string => {
  return attributes.amount?.toString() || 
         attributes.amountIn?.toString() || 
         attributes.value?.toString() || 
         "0";
};

export const getEventsBatch = async (
  contractAddresses: string[],
  eventNames: string[],
  minBlockNumber: number,
): Promise<ProtocolEvent[]> => {
  try {
    if (contractAddresses.length === 0 || eventNames.length === 0) {
      return [];
    }

    const addressFilter = contractAddresses.length === 1 
      ? `eq.${contractAddresses[0]}`
      : `in.(${contractAddresses.join(",")})`;
    
    const eventNameFilter = eventNames.length === 1
      ? `eq.${eventNames[0]}`
      : `in.(${eventNames.join(",")})`;

    const params: Record<string, any> = {
      address: addressFilter,
      event_name: eventNameFilter,
      block_number: `gt.${minBlockNumber}`,
      order: "block_number.asc,event_index.asc",
      select: "address,block_number,event_name,attributes,block_timestamp,block_hash",
    };

    const data = await cirrus.get("/event", { params });

    if (!Array.isArray(data) || !data.length) {
      return [];
    }

    const events: ProtocolEvent[] = [];

    for (const item of data as CirrusEvent[]) {
      const attributes = typeof item.attributes === "string" 
        ? JSON.parse(item.attributes) 
        : item.attributes;

      events.push({
        contractAddress: item.address,
        eventName: item.event_name,
        user: extractUserFromAttributes(attributes),
        amount: extractAmountFromAttributes(attributes),
        blockNumber: Number(item.block_number),
        txHash: item.block_hash,
        timestamp: item.block_timestamp,
      });
    }

    logInfo("CirrusService", `Fetched ${events.length} events from event table`, {
      contractAddresses: contractAddresses.length,
      eventNames: eventNames.length,
      minBlockNumber,
    });

    return events;
  } catch (error) {
    logError("CirrusService", error as Error, {
      operation: "getEventsBatch",
      contractAddresses: contractAddresses.length,
      eventNames: eventNames.length,
    });
    return [];
  }
};


