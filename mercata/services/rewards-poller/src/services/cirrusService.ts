import { cirrus } from "../utils/api";
import { ProtocolEvent, CirrusEvent } from "../types";
import { logError, logInfo } from "../utils/logger";
import { config } from "../config";
import { blockTrackingService } from "./blockTrackingService";
import {
  buildFilter,
  parseJson,
  sortEventsByBlock,
  ZERO_ADDRESS,
} from "../utils/eventHelpers";
import {
  loadAttributeMapping,
  extractAmountFromAttributes,
  splitAddressesAndEvents,
  AttributeMapping,
} from "../utils/attributeMapping";

const MERCATA_PREFIX = "BlockApps-";

const queryRegularEvents = async (
  eventAddresses: string[],
  eventEventNames: string[],
  minBlockNumber: number,
  mapping: AttributeMapping
): Promise<ProtocolEvent[]> => {
  if (eventAddresses.length === 0 || eventEventNames.length === 0) {
    return [];
  }

  const params: Record<string, any> = {
    address: buildFilter(eventAddresses),
    event_name: buildFilter(eventEventNames),
    block_number: `gt.${minBlockNumber}`,
    order: "block_number.asc,event_index.asc",
    select:
      "address,block_number,event_name,attributes,event_index,transaction_sender,block_timestamp",
  };

  const data = await cirrus.get("/event", { params });
  if (!Array.isArray(data) || !data.length) {
    return [];
  }

  const results = await Promise.all(
    (data as CirrusEvent[]).map(async (item) => {
      const attributes = parseJson(item.attributes);
      console.log(attributes);
      const amount = await extractAmountFromAttributes(
        attributes,
        item.address,
        item.event_name,
        mapping,
        item.block_timestamp
      );

      if (amount === null) return null;

      return {
        address: item.address,
        event_name: item.event_name,
        block_number: Number(item.block_number),
        event_index: Number(item.event_index),
        transaction_sender: item.transaction_sender,
        amount,
      } as ProtocolEvent;
    })
  );

  return results.filter((event): event is ProtocolEvent => event !== null);
};

export const getEventQueryParams = async (): Promise<{
  contractAddresses: string[];
  eventNames: string[];
  minBlockNumber: number;
}> => {
  const activitiesData = await cirrus.get("/mapping", {
    params: {
      address: `eq.${config.rewards.address}`,
      collection_name: `eq.activities`,
      select: "value->>sourceContract,value->>actionableEvents",
    },
  });

  const contractAddresses = new Set<string>();
  const eventNames = new Set<string>();

  if (Array.isArray(activitiesData) && activitiesData.length > 0) {
    for (const item of activitiesData) {
      if (!item.sourceContract || !item.actionableEvents) {
        continue;
      }

      const actionableEventsArray =
        typeof item.actionableEvents === "string"
          ? JSON.parse(item.actionableEvents)
          : [];

      for (const evt of actionableEventsArray) {
        if (evt.eventName) {
          contractAddresses.add(item.sourceContract);
          eventNames.add(evt.eventName);
        }
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

  logInfo(
    "CirrusService",
    `Loaded activities: ${contractAddresses.size} contracts, ${eventNames.size} event names, minBlock: ${minBlockNumber}`
  );
  return {
    contractAddresses: [...contractAddresses],
    eventNames: [...eventNames],
    minBlockNumber,
  };
};

export const getLPTokenTransferEvents = async (
  lpTokenAddresses: string[],
  lpEventNames: string[],
  minBlockNumber: number
): Promise<ProtocolEvent[]> => {
  if (lpTokenAddresses.length === 0 || lpEventNames.length === 0) {
    return [];
  }

  const params: Record<string, any> = {
    address: buildFilter(lpTokenAddresses),
    or: `(from.eq.${ZERO_ADDRESS},to.eq.${ZERO_ADDRESS})`,
    block_number: `gt.${minBlockNumber}`,
    order: "block_number.asc,event_index.asc",
    select: "address,block_number,value,event_index,transaction_sender,from,to",
  };

  const data = await cirrus.get(`/${MERCATA_PREFIX}Token-Transfer`, {
    params,
  });

  if (!Array.isArray(data) || !data.length) {
    return [];
  }

  const wantsMint = lpEventNames.includes("Minted");
  const wantsBurn = lpEventNames.includes("Burned");

  return data
    .filter((item) => {
      const isMint = item.from === ZERO_ADDRESS;
      const isBurn = item.to === ZERO_ADDRESS;
      return (isMint && wantsMint) || (isBurn && wantsBurn);
    })
    .map((item) => {
      const isMint = item.from === ZERO_ADDRESS;
      return {
        address: item.address,
        event_name: isMint ? "Minted" : "Burned",
        block_number: Number(item.block_number),
        event_index: Number(item.event_index || 0),
        transaction_sender:
          item.transaction_sender || (isMint ? item.to : item.from),
        amount: item.value?.toString() || "0",
      };
    });
};

export const getEventsBatch = async (
  contractAddresses: string[],
  eventNames: string[],
  minBlockNumber: number
): Promise<ProtocolEvent[]> => {
  if (contractAddresses.length === 0 || eventNames.length === 0) {
    return [];
  }

  const mapping = loadAttributeMapping();
  const { eventAddresses, lpTokenAddresses, eventEventNames, lpEventNames } =
    splitAddressesAndEvents(contractAddresses, eventNames, mapping);

  const [regularEvents, lpTransferEvents] = await Promise.all([
    queryRegularEvents(
      eventAddresses,
      eventEventNames,
      minBlockNumber,
      mapping
    ),
    getLPTokenTransferEvents(lpTokenAddresses, lpEventNames, minBlockNumber),
  ]);

  const allEvents = sortEventsByBlock([...regularEvents, ...lpTransferEvents]);

  logInfo(
    "CirrusService",
    `Fetched ${allEvents.length} events (${regularEvents.length} regular, ${lpTransferEvents.length} LP transfers)`,
    {
      contractAddresses: contractAddresses.length,
      eventNames: eventNames.length,
      minBlockNumber,
    }
  );

  return allEvents;
};
