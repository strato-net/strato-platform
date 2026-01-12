import { getTokenMetadata } from "../helpers/cirrusHelpers";
import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import * as fs from 'fs';
import * as path from 'path';

export type TokenMap = Map<string, { name: string; symbol: string }>;

export interface ActivityEventConfig {
  type: string;          
  title: string;         
  defaultToken?: string;  
}

export interface FieldConfig {
  symbolFields: string[];
  tokenAddressFields: string[];
  amountFields: string[];
  contractTokenDefaults: Array<{ pattern: string; token: string }>;
}

interface ActivityEventsConfigFile {
  events: Record<string, ActivityEventConfig>;
  fields: FieldConfig;
  cache: { ttlMs: number };
}

// Default fallback configuration (used if JSON file fails to load)
const DEFAULT_CONFIG: ActivityEventsConfigFile = {
  events: {
    'Deposited': { type: 'deposit', title: 'Deposit' },
    'Withdrawn': { type: 'withdraw', title: 'Withdraw' },
    'Swap': { type: 'swap', title: 'Swap' },
  },
  fields: {
    symbolFields: ['tokenSymbol', 'symbol', '_symbol'],
    tokenAddressFields: ['token', 'asset', 'tokenIn', 'tokenOut'],
    amountFields: ['amount', 'assets', 'value'],
    contractTokenDefaults: []
  },
  cache: { ttlMs: 300000 }
};

let loadedConfig: ActivityEventsConfigFile | null = null;
let configLoadTimestamp: number = 0;
const CONFIG_RELOAD_INTERVAL_MS = 60000; // Reload config every 60 seconds

/** Load activity events configuration from JSON file */
const loadConfigFromFile = (): ActivityEventsConfigFile => {
  try {
    const configPath = path.join(__dirname, '../../config/activityEvents.config.json');
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(fileContent) as ActivityEventsConfigFile;
    console.debug('Loaded activity events config from file');
    return config;
  } catch (error) {
    console.warn('Failed to load activityEvents.config.json, using defaults:', error);
    return DEFAULT_CONFIG;
  }
};

/** Get configuration with automatic reloading */
const getConfig = (): ActivityEventsConfigFile => {
  const now = Date.now();
  if (!loadedConfig || (now - configLoadTimestamp) > CONFIG_RELOAD_INTERVAL_MS) {
    loadedConfig = loadConfigFromFile();
    configLoadTimestamp = now;
  }
  return loadedConfig;
};

/** Force reload configuration from file */
export const reloadActivityConfig = (): void => {
  loadedConfig = loadConfigFromFile();
  configLoadTimestamp = Date.now();
  // Clear cached derived values
  cachedActivityEvents = null;
  cacheTimestamp = 0;
};

/** Get event configuration map */
export const getActivityEventConfig = (): Record<string, ActivityEventConfig> => {
  return getConfig().events;
};

/** Get field configuration */
export const getFieldConfig = (): FieldConfig => {
  return getConfig().fields;
};

/** Get cache TTL from config */
const getCacheTtlMs = (): number => {
  return getConfig().cache?.ttlMs || 300000;
};

// For backwards compatibility - these are now dynamic getters
export const ACTIVITY_EVENT_CONFIG = new Proxy({} as Record<string, ActivityEventConfig>, {
  get: (_, prop: string) => getActivityEventConfig()[prop],
  ownKeys: () => Object.keys(getActivityEventConfig()),
  getOwnPropertyDescriptor: (_, prop: string) => ({
    enumerable: true,
    configurable: true,
    value: getActivityEventConfig()[prop as string]
  })
});

export const FIELD_CONFIG = new Proxy({} as FieldConfig, {
  get: (_, prop: string) => getFieldConfig()[prop as keyof FieldConfig]
});

/** List of all activity event names (dynamic) */
export const ACTIVITY_EVENTS: string[] = new Proxy([] as string[], {
  get: (_, prop) => {
    const events = Object.keys(getActivityEventConfig());
    if (prop === 'length') return events.length;
    if (prop === Symbol.iterator) return events[Symbol.iterator].bind(events);
    if (typeof prop === 'string' && !isNaN(Number(prop))) return events[Number(prop)];
    if (prop === 'filter') return events.filter.bind(events);
    if (prop === 'map') return events.map.bind(events);
    if (prop === 'forEach') return events.forEach.bind(events);
    if (prop === 'includes') return events.includes.bind(events);
    if (prop === 'join') return events.join.bind(events);
    return (events as any)[prop];
  }
}) as unknown as string[];

/** Map of event names to activity types (dynamic) */
export const EVENT_TYPE_MAP: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, prop: string) => {
    const config = getActivityEventConfig();
    return config[prop]?.type || 'other';
  },
  ownKeys: () => Object.keys(getActivityEventConfig()),
  getOwnPropertyDescriptor: (_, prop: string) => ({
    enumerable: true,
    configurable: true,
    value: getActivityEventConfig()[prop]?.type
  })
});

// Cache for activity events fetched from Cirrus
let cachedActivityEvents: string[] | null = null;
let cacheTimestamp: number = 0;

export const fetchActivityEventsFromCirrus = async (
  accessToken: string,
  forceRefresh: boolean = false
): Promise<string[]> => {
  const now = Date.now();
  const cacheTtl = getCacheTtlMs();
  
  if (!forceRefresh && cachedActivityEvents && (now - cacheTimestamp) < cacheTtl) {
    return cachedActivityEvents;
  }

  try {
    const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
      params: {
        select: "event_name",
        "storage.contract.contract_name": "neq.Proxy",
      },
    });

    const onChainEvents = new Set<string>();
    (data || []).forEach((event: any) => {
      if (event?.event_name) {
        onChainEvents.add(event.event_name);
      }
    });

    // Get configured events dynamically
    const configuredEvents = Object.keys(getActivityEventConfig());
    
    // Filter to only include events that exist on-chain AND in our config
    const validActivityEvents = configuredEvents.filter(eventName => 
      onChainEvents.has(eventName)
    );

    const missingEvents = configuredEvents.filter(eventName => 
      !onChainEvents.has(eventName)
    );
    if (missingEvents.length > 0) {
      console.debug(`Activity events not found on-chain: ${missingEvents.join(', ')}`);
    }

    cachedActivityEvents = validActivityEvents.length > 0 ? validActivityEvents : configuredEvents;
    cacheTimestamp = now;

    return cachedActivityEvents;
  } catch (error) {
    console.error('Failed to fetch activity events from Cirrus:', error);
    return Object.keys(getActivityEventConfig());
  }
};

/** Gets activity events - uses cached Cirrus data if available */
export const getActivityEvents = (): string[] => {
  return cachedActivityEvents || ACTIVITY_EVENTS;
};

/** Clears the activity events cache */
export const clearActivityEventsCache = (): void => {
  cachedActivityEvents = null;
  cacheTimestamp = 0;
};

/** Get event config or return defaults */
const getEventConfig = (eventName: string): ActivityEventConfig => {
  return ACTIVITY_EVENT_CONFIG[eventName] || { type: 'other', title: eventName };
};

/** Check if value looks like a blockchain address */
const isAddress = (val: string): boolean => 
  typeof val === 'string' && /^[0-9a-fA-F]{40}$/.test(val);

/** Format large wei amounts to human-readable decimals */
export const formatAmount = (amount: string): string => {
  if (!amount || amount === '0') return '0';
  try {
    const num = BigInt(amount);
    if (num > BigInt(1e9)) {
      const formatted = Number(num) / 1e18;
      return formatted.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
  } catch {
    return amount;
  }
};

/** Look up token symbol from address using token map */
const lookupTokenSymbol = (address: string, tokenMap: TokenMap): string => 
  tokenMap.get(address.toLowerCase())?.symbol || '';

/** Extract token symbol from event attributes using dynamic field config */
const extractToken = (attrs: any, contractName: string, eventName: string, tokenMap: TokenMap): string => {
  const fieldConfig = getFieldConfig();
  
  // Check symbol fields first (from config)
  for (const field of fieldConfig.symbolFields) {
    const val = attrs?.[field];
    if (val && typeof val === 'string' && !isAddress(val)) return val;
  }
  
  // Look up token addresses (from config)
  for (const field of fieldConfig.tokenAddressFields) {
    const addr = attrs?.[field];
    if (addr && isAddress(addr)) {
      const symbol = lookupTokenSymbol(addr, tokenMap);
      if (symbol) return symbol;
    }
  }
  
  // Use event-specific default token from unified config
  const eventConfig = getEventConfig(eventName);
  if (eventConfig.defaultToken) return eventConfig.defaultToken;
  
  // Check contract name patterns for default tokens
  for (const { pattern, token } of fieldConfig.contractTokenDefaults) {
    if (contractName?.includes(pattern)) return token;
  }
  
  return '';
};

/** Build descriptive title using unified config */
const buildTitle = (eventName: string, attrs: any, tokenMap: TokenMap): string => {
  const eventConfig = getEventConfig(eventName);
  const base = eventConfig.title;
  
  // Special case for Swap: show token pair
  if (eventName === 'Swap') {
    const inAddr = attrs?.tokenIn;
    const outAddr = attrs?.tokenOut;
    const inSymbol = inAddr && isAddress(inAddr) ? lookupTokenSymbol(inAddr, tokenMap) : (attrs?.tokenInSymbol || '');
    const outSymbol = outAddr && isAddress(outAddr) ? lookupTokenSymbol(outAddr, tokenMap) : (attrs?.tokenOutSymbol || '');
    if (inSymbol && outSymbol) return `Swap ${inSymbol} to ${outSymbol}`;
  }
  
  return base;
};

/** Build description using dynamic config */
const buildDescription = (eventName: string, attrs: any, contractName: string, tokenMap: TokenMap): string => {
  const token = extractToken(attrs, contractName, eventName, tokenMap);
  const fieldConfig = getFieldConfig();
  
  // Get amount from configured fields
  let rawAmount = '0';
  for (const field of fieldConfig.amountFields) {
    if (attrs?.[field] && attrs[field] !== '0') {
      rawAmount = attrs[field];
      break;
    }
  }
  
  const amount = formatAmount(rawAmount);
  const eventConfig = getEventConfig(eventName);
  const action = eventConfig.title.toLowerCase();
  
  return token ? `${action} ${amount} ${token}` : `${action} ${amount}`;
};

/** Extract all token addresses from events for batch lookup */
export const extractTokenAddresses = (events: any[]): string[] => {
  const addresses = new Set<string>();
  const fieldConfig = getFieldConfig();
  
  events.forEach(event => {
    const attrs = event.attributes || {};
    // Use token address fields from config
    fieldConfig.tokenAddressFields.forEach(field => {
      const val = attrs[field];
      if (val && isAddress(val)) addresses.add(val.toLowerCase());
    });
  });
  
  return Array.from(addresses);
};

// Fetch token metadata for addresses
export const fetchTokenMetadata = async (
  accessToken: string, 
  addresses: string[]
): Promise<TokenMap> => {
  const tokenMap: TokenMap = new Map();
  if (!addresses.length) return tokenMap;
  
  try {
    const metadata = await getTokenMetadata(accessToken, addresses);
    // getTokenMetadata returns a Map<address, {name, symbol}>
    metadata.forEach((value: { name: string; symbol: string }, address: string) => {
      tokenMap.set(address.toLowerCase(), {
        name: value.name || '',
        symbol: value.symbol || ''
      });
    });
  } catch (err) {
    // Silently handle auth errors - just return empty map
    console.error('Failed to fetch token metadata:', err);
  }
  
  return tokenMap;
};

// Activity item interface
export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  fromAddress: string;
  amount: string;
  token: string;
  timestamp: string;
  contractName: string;
  eventName: string;
}

/** Transform raw event to ActivityItem using dynamic config */
export const transformEvent = (event: any, tokenMap: TokenMap): ActivityItem => {
  const attrs = event.attributes || {};
  const eventName = event.event_name || '';
  const contractName = event.storage?.contract?.[0]?.contract_name || '';
  const eventConfig = getEventConfig(eventName);
  const fieldConfig = getFieldConfig();
  
  // Get amount from configured fields
  let rawAmount = '0';
  for (const field of fieldConfig.amountFields) {
    if (attrs[field] && attrs[field] !== '0') {
      rawAmount = attrs[field];
      break;
    }
  }
  
  return {
    id: event.id?.toString() || '',
    type: eventConfig.type,
    title: buildTitle(eventName, attrs, tokenMap),
    description: buildDescription(eventName, attrs, contractName, tokenMap),
    fromAddress: event.transaction_sender || '',
    amount: formatAmount(rawAmount),
    token: extractToken(attrs, contractName, eventName, tokenMap),
    timestamp: event.block_timestamp || '',
    contractName,
    eventName
  };
};

