import { cirrus } from "../utils/api";
import { ProtocolEvent, CirrusEvent, EventCursor } from "../types";
import { logInfo } from "../utils/logger";
import { config } from "../config";
import { blockTrackingService } from "./blockTrackingService";
import { getCommunityBonuses } from "../utils/balanceCheck";
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
  cursor: EventCursor,
  mapping: AttributeMapping,
  validPairs: ValidEventPairs
): Promise<ProtocolEvent[]> => {
  if (eventAddresses.length === 0 || eventEventNames.length === 0) {
    return [];
  }

  const params: Record<string, any> = {
    address: buildFilter(eventAddresses),
    event_name: buildFilter(eventEventNames),
    block_timestamp: `gte.${cursor.block_timestamp}`,
    order: "id.asc",
    select:
      "address,block_number,event_name,attributes,event_index,transaction_sender,block_timestamp",
  };

  const data = await cirrus.get("/event", { params });
  if (!Array.isArray(data) || !data.length) {
    return [];
  }

  const results = await Promise.all(
    (data as CirrusEvent[]).map(async (item) => {
      const blockNumber = Number(item.block_number);
      const eventIndex = Number(item.event_index);

      if (
        blockNumber < cursor.blockNumber ||
        (blockNumber === cursor.blockNumber && eventIndex <= cursor.eventIndex)
      ) {
        return null;
      }

      const pairKey = makeEventPairKey(item.address, item.event_name);
      if (!validPairs.has(pairKey)) {
        return null;
      }

      const attributes = parseJson(item.attributes);
      const amount = await extractAmountFromAttributes(
        attributes,
        item.address,
        item.event_name,
        mapping,
        item.block_timestamp
      );

      if (amount === null) return null;

      const userAttr = mapping[item.address]?.[item.event_name]?.user;
      const user = userAttr ? (attributes[userAttr] || item.transaction_sender) : item.transaction_sender;

      return {
        address: item.address,
        event_name: item.event_name,
        block_number: blockNumber,
        block_timestamp: item.block_timestamp,
        event_index: eventIndex,
        transaction_sender: user,
        amount,
      } as ProtocolEvent;
    })
  );

  return results
    .filter((event): event is ProtocolEvent => event !== null)
    .flatMap((event) => [event, ...getCommunityBonuses(event)]);
};

export type ValidEventPairs = Set<string>;

const makeEventPairKey = (contract: string, eventName: string): string =>
  `${contract}:${eventName}`;

export const getEventQueryParams = async (): Promise<{
  contractAddresses: string[];
  eventNames: string[];
  cursor: EventCursor;
  validPairs: ValidEventPairs;
}> => {
  const activitiesData = await cirrus.get("/mapping", {
    params: {
      address: `eq.${config.rewards.address}`,
      collection_name: `eq.activities`,
      "value->>emissionRate": "neq.0000000000000000000000000000000000000000", // Might break if rate becomes 0 on cirrus
      select: "value->>sourceContract,value->>actionableEvents",
    },
  });

  const contractAddresses = new Set<string>();
  const eventNames = new Set<string>();
  const validPairs: ValidEventPairs = new Set<string>();

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
          validPairs.add(makeEventPairKey(item.sourceContract, evt.eventName));
        }
      }
    }
  }

  const cursor = await blockTrackingService.getCursor();

  logInfo(
    "CirrusService",
    `Loaded activities: ${contractAddresses.size} contracts, ${eventNames.size} event names, cursor: blockNumber=${cursor.blockNumber}, eventIndex=${cursor.eventIndex}, block_timestamp=${cursor.block_timestamp}`
  );
  return {
    contractAddresses: [...contractAddresses],
    eventNames: [...eventNames],
    cursor,
    validPairs,
  };
};

export const getLPTokenTransferEvents = async (
  lpTokenAddresses: string[],
  lpEventNames: string[],
  cursor: EventCursor
): Promise<ProtocolEvent[]> => {
  if (lpTokenAddresses.length === 0 || lpEventNames.length === 0) {
    return [];
  }

  const params: Record<string, any> = {
    address: buildFilter(lpTokenAddresses),
    or: `(from.eq.${ZERO_ADDRESS},to.eq.${ZERO_ADDRESS})`,
    block_timestamp: `gte.${cursor.block_timestamp}`,
    order: "id.asc",
    select: "address,block_number,value::text,event_index,transaction_sender,from,to,block_timestamp",
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
      const blockNumber = Number(item.block_number);
      const eventIndex = Number(item.event_index || 0);

      if (
        blockNumber < cursor.blockNumber ||
        (blockNumber === cursor.blockNumber && eventIndex <= cursor.eventIndex)
      ) {
        return false;
      }

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
        block_timestamp: item.block_timestamp,
        event_index: Number(item.event_index || 0),
        transaction_sender:
          item.transaction_sender || (isMint ? item.to : item.from),
        amount: item.value || "0",
      };
    })
    .flatMap((event) => [event, ...getCommunityBonuses(event)]);
};

export const getEventsBatch = async (
  contractAddresses: string[],
  eventNames: string[],
  cursor: EventCursor,
  validPairs: ValidEventPairs
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
      cursor,
      mapping,
      validPairs
    ),
    getLPTokenTransferEvents(lpTokenAddresses, lpEventNames, cursor),
  ]);

  const allEvents = sortEventsByBlock([...regularEvents, ...lpTransferEvents]);

  logInfo(
    "CirrusService",
    `Fetched ${allEvents.length} events (${regularEvents.length} regular, ${lpTransferEvents.length} LP transfers)`,
    {
      contractAddresses: contractAddresses.length,
      eventNames: eventNames.length,
      cursor: `blockNumber=${cursor.blockNumber}, eventIndex=${cursor.eventIndex}`,
    }
  );

  return allEvents;
};
