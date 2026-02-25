import { cirrus } from "../utils/api";
import { ProtocolEvent, CirrusEvent, EventCursor, BonusTokenConfig, BonusEligibleUser } from "../types";
import { logError, logInfo } from "../utils/logger";
import { config } from "../config";
import { blockTrackingService } from "./blockTrackingService";
import { retryWithBackoff } from "../utils/retry";
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

const CIRRUS_RETRY_OPTS = { maxAttempts: 3, initialDelay: 5000, maxDelay: 5000 };

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

  return results.filter((event): event is ProtocolEvent => event !== null);
};

export type ValidEventPairs = Set<string>;

const makeEventPairKey = (contract: string, eventName: string): string =>
  `${contract}:${eventName}`;

const normalizeAddress = (address: string): string =>
  address.toLowerCase().replace(/^0x/, "");

const isDirectPayoutEnabled = (directPayout: unknown): boolean =>
  directPayout === true ||
  directPayout === "true" ||
  directPayout === "1" ||
  directPayout === 1;

const parseActionableEventNames = (actionableEvents: unknown): string[] => {
  if (!actionableEvents) return [];

  if (typeof actionableEvents === "string") {
    try {
      return parseActionableEventNames(parseJson(actionableEvents));
    } catch {
      return [];
    }
  }

  if (Array.isArray(actionableEvents)) {
    return actionableEvents
      .map((event) => String(event?.eventName ?? "").trim())
      .filter((eventName) => eventName.length > 0);
  }

  if (typeof actionableEvents === "object") {
    return Object.keys(actionableEvents as Record<string, unknown>)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) =>
        String((actionableEvents as Record<string, any>)[key]?.eventName ?? "").trim()
      )
      .filter((eventName) => eventName.length > 0);
  }

  return [];
};

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

      let actionableEventsArray: any[] = [];
      if (typeof item.actionableEvents === "string") {
        try {
          const parsed = JSON.parse(item.actionableEvents);
          actionableEventsArray = Array.isArray(parsed)
            ? parsed
            : Object.keys(parsed || {})
                .filter((key) => /^\d+$/.test(key))
                .sort((a, b) => Number(a) - Number(b))
                .map((key) => parsed[key]);
        } catch {
          actionableEventsArray = [];
        }
      }

      for (const evt of actionableEventsArray) {
        if (evt?.eventName) {
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
    });
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

export const getBonusEligibleUsers = async (
  tokenConfigs: BonusTokenConfig[]
): Promise<BonusEligibleUser[]> => {
  if (tokenConfigs.length === 0) return [];

  const ruleByToken = new Map(
    tokenConfigs.map((c) => [
      normalizeAddress(c.address),
      {
        sourceContract: c.address,
        bonusBps: c.bonusBps,
        minBalance: BigInt(c.minBalance),
      },
    ])
  );

  const addresses = [...ruleByToken.keys()];
  const data = await retryWithBackoff(
    () => cirrus.get("/BlockApps-Token-_balances", {
      params: {
        address: `in.(${addresses.join(",")})`,
        select: "address,user:key,balance:value::text",
      },
    }),
    "CirrusService-getBonusEligibleUsers",
    CIRRUS_RETRY_OPTS
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  const userBonusMap = new Map<string, BonusEligibleUser>();
  for (const row of data) {
    const rule = ruleByToken.get(normalizeAddress(String(row.address ?? "")));
    if (!rule || BigInt(row.balance || "0") <= rule.minBalance) continue;

    const current = userBonusMap.get(row.user);
    if (!current || rule.bonusBps > current.bonusBps) {
      userBonusMap.set(row.user, {
        sourceContract: rule.sourceContract,
        user: row.user,
        bonusBps: rule.bonusBps,
      });
    }
  }

  const users = [...userBonusMap.values()];
  logInfo("CirrusService", `Loaded ${users.length} bonus-eligible users from ${addresses.length} bonus tokens`);
  return users;
};

export const getUserEmissionRates = async (
  users: string[],
  bonusTokenAddresses: string[] = []
): Promise<{ rateByUser: Map<string, bigint>; bonusEventByToken: Map<string, string> }> => {
  if (users.length === 0 && bonusTokenAddresses.length === 0) {
    return { rateByUser: new Map(), bonusEventByToken: new Map() };
  }

  const rewardsAddress = config.rewards.address;
  const mappingRows = await retryWithBackoff(
    () => cirrus.get("/mapping", {
      params: {
        address: `eq.${rewardsAddress}`,
        collection_name: "in.(activities,activityStates,userInfo)",
        select: "collection_name,key,value",
      },
    }),
    "CirrusService-getUserEmissionRates",
    CIRRUS_RETRY_OPTS
  );

  const parseValue = (v: any): any => {
    if (v && typeof v === "object") return v;
    if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } }
    return {};
  };

  const getKeyParts = (key: any): { key1: string; key2: string } => {
    if (key && typeof key === "object") {
      const key1 = String((key as any).key ?? "");
      const key2 = String((key as any).key2 ?? "");
      return { key1, key2 };
    }
    return { key1: String(key ?? ""), key2: "" };
  };

  const toBigInt = (v: any): bigint => {
    try { return BigInt(v); } catch { return 0n; }
  };

  const targetUsers = new Set(users.map((u) => u.toLowerCase()));
  const requestedBonusTokens = new Set(
    bonusTokenAddresses.map((address) => normalizeAddress(address))
  );
  const emissionByActivity = new Map<string, bigint>();
  const totalStakeByActivity = new Map<string, bigint>();
  const directPayoutEventsByToken = new Map<string, Set<string>>();
  const userRows: Array<{ user: string; activityId: string; stake: bigint }> = [];
  const rateByUser = new Map<string, bigint>();
  if (Array.isArray(mappingRows)) {
    for (const row of mappingRows) {
      const collectionName = String(row.collection_name ?? "");
      const { key1, key2 } = getKeyParts(row.key);
      const value = parseValue(row.value);

      if (collectionName === "activities") {
        if (key1.length > 0) {
          emissionByActivity.set(key1, toBigInt(value.emissionRate));
        }

        const sourceContract = normalizeAddress(String(value.sourceContract ?? "").trim());
        if (
          requestedBonusTokens.has(sourceContract) &&
          isDirectPayoutEnabled(value.directPayout)
        ) {
          for (const eventName of parseActionableEventNames(value.actionableEvents)) {
            const events = directPayoutEventsByToken.get(sourceContract) ?? new Set<string>();
            events.add(eventName);
            directPayoutEventsByToken.set(sourceContract, events);
          }
        }
        continue;
      }

      if (collectionName === "activityStates") {
        if (key1.length > 0) {
          totalStakeByActivity.set(key1, toBigInt(value.totalStake));
        }
        continue;
      }

      if (collectionName === "userInfo") {
        const user = key1;
        const activityId = key2;
        if (user.length === 0 || activityId.length === 0 || !targetUsers.has(user.toLowerCase())) {
          continue;
        }

        const stake = toBigInt(value.stake);
        if (stake <= 0n) continue;
        userRows.push({ user, activityId, stake });
      }
    }
  }

  for (const { user, activityId, stake } of userRows) {
    const emissionRate = emissionByActivity.get(activityId) ?? 0n;
    const totalStake = totalStakeByActivity.get(activityId) ?? 0n;
    if (emissionRate <= 0n || totalStake <= 0n) continue;

    const personalRate = (stake * emissionRate) / totalStake;
    rateByUser.set(user, (rateByUser.get(user) ?? 0n) + personalRate);
  }

  const bonusEventByToken = new Map<string, string>();
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (const token of requestedBonusTokens) {
    const events = directPayoutEventsByToken.get(token);
    if (!events || events.size === 0) {
      missing.push(token);
      continue;
    }

    if (events.size > 1) {
      ambiguous.push(`${token}=>[${[...events].join(",")}]`);
      continue;
    }

    bonusEventByToken.set(token, [...events][0]);
  }

  if (missing.length > 0 || ambiguous.length > 0) {
    const details = [
      missing.length > 0 ? `missing direct payout activity for: ${missing.join(", ")}` : "",
      ambiguous.length > 0 ? `multiple direct payout events per token (ambiguous): ${ambiguous.join("; ")}` : "",
    ].filter(Boolean).join(" | ");

    throw new Error(`Invalid direct payout activity mapping: ${details}`);
  }

  logInfo("CirrusService", `Computed emission rates for ${rateByUser.size}/${users.length} users`);
  return { rateByUser, bonusEventByToken };
};
