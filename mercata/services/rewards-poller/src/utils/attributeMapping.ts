import { readFileSync } from "fs";
import { join } from "path";
import { logError, logInfo } from "./logger";
import { cirrus } from "./api";
import { config } from "../config";
import { parseJson } from "./eventHelpers";

const MERCATA_PREFIX = "BlockApps-";
const PriceOracleEvents = `${MERCATA_PREFIX}PriceOracle-PriceUpdated`;
const PriceOracleBatchUpdateEvents = `${MERCATA_PREFIX}PriceOracle-BatchPricesUpdated`;

const PRICE_CONVERSION_MAP: Record<string, string> = {
  Swap: "tokenIn",
  DepositInitiated: "stratoToken",
  WithdrawalRequested: "token",
};

const DEPOSIT_WITHDRAW_EVENTS = new Set(["DepositInitiated", "WithdrawalRequested"]);

const toBigIntSafeString = (value: string | number): string => {
  if (typeof value === "string") {
    return value;
  }
  return value.toLocaleString("fullwide", { useGrouping: false });
};

export interface AttributeMapping {
  [contractAddress: string]: {
    [eventName: string]: {
      amount: string;
      user?: string;
    };
  };
}

let attributeMapping: AttributeMapping | null = null;

export const loadAttributeMapping = (): AttributeMapping => {
  if (attributeMapping !== null) {
    return attributeMapping;
  }

  try {
    const mappingPath = join(__dirname, "../config/attributeMapping.json");
    const fileContent = readFileSync(mappingPath, "utf-8");
    attributeMapping = JSON.parse(fileContent) as AttributeMapping;
    logInfo("AttributeMapping", "Loaded attribute mapping from config");
    return attributeMapping;
  } catch (error) {
    logError("AttributeMapping", error as Error, {
      operation: "loadAttributeMapping",
    });
    attributeMapping = {};
    return attributeMapping;
  }
};

const getPriceAtTimestamp = async (
  tokenAddress: string,
  blockTimestamp: string
): Promise<string | null> => {
  if (!config.priceOracle.address) {
    return null;
  }

  try {
    const baseParams = {
      address: `eq.${config.priceOracle.address}`,
      block_timestamp: `lte.${blockTimestamp}`,
      order: "block_timestamp.desc",
      limit: 1,
    };

    const [singleResponse, batchResponse] = await Promise.all([
      cirrus
        .get(`/${PriceOracleEvents}`, {
          params: {
            ...baseParams,
            asset: `eq.${tokenAddress}`,
            select: "price,block_timestamp",
          },
        })
        .catch(() => []),
      cirrus
        .get(`/${PriceOracleBatchUpdateEvents}`, {
          params: {
            ...baseParams,
            select: "assets,priceValues,block_timestamp",
          },
        })
        .catch(() => []),
    ]);

    const singleEvent =
      Array.isArray(singleResponse) && singleResponse.length > 0
        ? singleResponse[0]
        : null;

    let batchPrice: string | null = null;
    let batchTimestamp: number | null = null;
    if (Array.isArray(batchResponse) && batchResponse.length > 0) {
      const event = batchResponse[0];
      const assets = parseJson(event.assets) as string[];
      const priceValues = (parseJson(event.priceValues) as any[]).map(String);
      const idx = assets.indexOf(tokenAddress);
      if (idx !== -1) {
        batchPrice = priceValues[idx];
        batchTimestamp = new Date(event.block_timestamp).getTime();
      }
    }
    if (!singleEvent && !batchPrice) {
      return null;
    }

    if (singleEvent && batchPrice && batchTimestamp !== null) {
      const singleTimestamp = new Date(singleEvent.block_timestamp).getTime();
      const singlePrice = toBigIntSafeString(singleEvent.price);
      return batchTimestamp > singleTimestamp ? batchPrice : singlePrice;
    }

    if (singleEvent) {
      return toBigIntSafeString(singleEvent.price);
    }

    return batchPrice;
  } catch (error) {
    logError("AttributeMapping", error as Error, {
      operation: "getPriceAtTimestamp",
      tokenAddress,
      blockTimestamp,
    });
    return null;
  }
};

export const extractAmountFromAttributes = async (
  attributes: Record<string, any>,
  contractAddress: string,
  eventName: string,
  mapping: AttributeMapping,
  blockTimestamp: string
): Promise<string | null> => {
  const eventMapping = mapping[contractAddress]?.[eventName];
  if (!eventMapping?.amount) {
    logError(
      "AttributeMapping",
      new Error(
        `No attribute mapping found for contract ${contractAddress}, event ${eventName}`
      ),
      {
        operation: "extractAmountFromAttributes",
        contractAddress,
        eventName,
        availableAttributes: Object.keys(attributes),
      }
    );
    return null;
  }

  const amount = attributes[eventMapping.amount];
  if (amount === undefined || amount === null) {
    logError(
      "AttributeMapping",
      new Error(`Amount attribute '${eventMapping.amount}' not found`),
      {
        operation: "extractAmountFromAttributes",
        contractAddress,
        eventName,
        availableAttributes: Object.keys(attributes),
      }
    );
    return null;
  }

  const tokenAttributeName = PRICE_CONVERSION_MAP[eventName];
  if (!tokenAttributeName) {
    return toBigIntSafeString(amount);
  }

  const tokenAddress = attributes[tokenAttributeName];
  if (!tokenAddress) {
    logError(
      "AttributeMapping",
      new Error(`${tokenAttributeName} not found in ${eventName} event`),
      {
        operation: "extractAmountFromAttributes",
        contractAddress,
        eventName,
        availableAttributes: Object.keys(attributes),
      }
    );
    return null;
  }

  const isDepositOrWithdraw = DEPOSIT_WITHDRAW_EVENTS.has(eventName);
  const isUsdt =
    tokenAddress.toLowerCase() === config.usdst.address.toLowerCase();

  if (isDepositOrWithdraw && !isUsdt) {
    logError(
      "AttributeMapping",
      new Error(
        `Non-USDT token ${tokenAddress} filtered out for ${eventName} event`
      ),
      {
        operation: "extractAmountFromAttributes",
        contractAddress,
        eventName,
        tokenAddress,
      }
    );
    return null;
  }

  const price = await getPriceAtTimestamp(tokenAddress, blockTimestamp);

  if (!price) {
    logError(
      "AttributeMapping",
      new Error(
        `Price not found for token ${tokenAddress} at timestamp ${blockTimestamp}`
      ),
      {
        operation: "extractAmountFromAttributes",
        contractAddress,
        eventName,
        tokenAddress,
        blockTimestamp,
      }
    );
    return null;
  }

  const amountStr = toBigIntSafeString(amount);
  const usdValue = (BigInt(amountStr) * BigInt(price)) / BigInt(10 ** 18);
  return usdValue.toString();
};

export const splitAddressesAndEvents = (
  contractAddresses: string[],
  eventNames: string[],
  mapping: AttributeMapping
): {
  eventAddresses: string[];
  lpTokenAddresses: string[];
  eventEventNames: string[];
  lpEventNames: string[];
} => {
  const eventAddresses: string[] = [];
  const lpTokenAddresses: string[] = [];
  const eventEventNames: string[] = [];
  const lpEventNames: string[] = [];

  for (const address of contractAddresses) {
    if (mapping[address]?.["Minted"] || mapping[address]?.["Burned"]) {
      lpTokenAddresses.push(address);
    } else {
      eventAddresses.push(address);
    }
  }

  for (const name of eventNames) {
    if (name === "Minted" || name === "Burned") {
      lpEventNames.push(name);
    } else {
      eventEventNames.push(name);
    }
  }

  return { eventAddresses, lpTokenAddresses, eventEventNames, lpEventNames };
};
