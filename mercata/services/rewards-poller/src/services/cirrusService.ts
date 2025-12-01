import { cirrus } from "../utils/api";
import { ProtocolEvent, CirrusEvent } from "../types";
import { logError, logInfo } from "../utils/logger";
import { config } from "../config";
import { readFileSync } from "fs";
import { join } from "path";
import { blockTrackingService } from "./blockTrackingService";

const MERCATA_PREFIX = "BlockApps-";

interface AttributeMapping {
  [contractAddress: string]: {
    [eventName: string]: {
      amount: string;
    };
  };
}

let attributeMapping: AttributeMapping | null = null;

const loadAttributeMapping = (): AttributeMapping => {
  if (attributeMapping !== null) {
    return attributeMapping;
  }

  try {
    const mappingPath = join(__dirname, "../config/attributeMapping.json");
    const fileContent = readFileSync(mappingPath, "utf-8");
    attributeMapping = JSON.parse(fileContent) as AttributeMapping;
    logInfo("CirrusService", "Loaded attribute mapping from config");
    return attributeMapping;
  } catch (error) {
    logError("CirrusService", error as Error, {
      operation: "loadAttributeMapping",
    });
    attributeMapping = {};
    return attributeMapping;
  }
};

const extractAmountFromAttributes = (
  attributes: Record<string, any>,
  contractAddress: string,
  eventName: string
): string | null => {
  const mapping = loadAttributeMapping();
  const eventMapping = mapping[contractAddress]?.[eventName];
  
  if (eventMapping?.amount) {
    const value = attributes[eventMapping.amount];
    if (value !== undefined && value !== null) {
      return value.toString();
    }
  }
  
  logError("CirrusService", new Error(`No attribute mapping found for contract ${contractAddress}, event ${eventName}`), {
    operation: "extractAmountFromAttributes",
    contractAddress,
    eventName,
    availableAttributes: Object.keys(attributes),
  });
  
  return null;
};

export const getEventQueryParams = async (): Promise<{
  contractAddresses: string[];
  eventNames: string[];
  minBlockNumber: number;
}> => {
  const activitiesData = await cirrus.get(`/${MERCATA_PREFIX}Rewards-activities`, {
    params: {
      address: `eq.${config.rewards.address}`,
      select: "value->>sourceContract,value->>actionableEvents",
    },
  });

  const contractAddresses = new Set<string>();
  const eventNames = new Set<string>();

  if (Array.isArray(activitiesData) && activitiesData.length > 0) {
    for (const item of activitiesData) {
      let actionableEventsArray: any[] = [];
      
      if (item.actionableEvents) {
        if (typeof item.actionableEvents === "string") {
          actionableEventsArray = JSON.parse(item.actionableEvents);
        } else {
          actionableEventsArray = item.actionableEvents;
        }
      }
      
      for (const evt of actionableEventsArray) {
        contractAddresses.add(item.sourceContract);
        eventNames.add(evt.eventName);
      }
    }
  }

  let minBlockNumber = 0;
  try {
    minBlockNumber = await blockTrackingService.getLastProcessedBlock();
  } catch (error) {
    logError("CirrusService", error as Error, {
      operation: "getEventQueryParams",
    });
    minBlockNumber = 0;
  }

  logInfo("CirrusService", `Loaded activities: ${contractAddresses.size} contracts, ${eventNames.size} event names, minBlock: ${minBlockNumber}`);
  
  return {
    contractAddresses: [...contractAddresses],
    eventNames: [...eventNames],
    minBlockNumber,
  };
};

export const getEventsBatch = async (
  contractAddresses: string[],
  eventNames: string[],
  minBlockNumber: number,
): Promise<ProtocolEvent[]> => {
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
    select: "address,block_number,event_name,attributes,event_index,transaction_sender",
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

    const amount = extractAmountFromAttributes(attributes, item.address, item.event_name);
    
    if (amount === null) {
      continue;
    }

    events.push({
      address: item.address,
      event_name: item.event_name,
      block_number: Number(item.block_number),
      event_index: Number(item.event_index),
      transaction_sender: item.transaction_sender,
      amount,
    });
  }

  logInfo("CirrusService", `Fetched ${events.length} events from event table`, {
    contractAddresses: contractAddresses.length,
    eventNames: eventNames.length,
    minBlockNumber,
  });

  return events;
};


