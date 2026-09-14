import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import {
  BURN_ADDRESSES,
  SUPPLY_TOKEN_SYMBOLS,
  SupplyExclusion,
  getNonCirculatingAddresses,
} from "../../config/supplyExclusions";

const { Token, StratoNativeCustodyVault } = constants;
const METHODOLOGY_VERSION = "1";

const METHODOLOGY = [
  "Total supply is the token's totalSupply on the STRATO chain. Burned tokens are already removed from it.",
  "Tokens bridged to Ethereum or another chain are locked in the STRATO custody vault and minted 1:1 there. They are counted once, on the STRATO chain, and never added again from the destination chain.",
  "Circulating supply is total supply minus balances held by listed non-circulating wallets and burn addresses.",
  "Staked tokens and tokens locked in the bridge custody vault remain circulating because users own them.",
];

interface TokenRow {
  address: string;
  _name?: string;
  _symbol?: string;
  _totalSupply?: string | number;
  customDecimals?: string | number;
}

export interface NonCirculatingBalance {
  address: string;
  label: string;
  balance: string;
}

export interface TokenSupply {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  totalSupply: string;
  circulatingSupply: string;
  totalSupplyFormatted: string;
  circulatingSupplyFormatted: string;
  nonCirculating: NonCirculatingBalance[];
  lockedInBridgeCustody: string;
}

export interface SupplyMetrics {
  timestamp: string;
  methodologyVersion: string;
  methodology: string[];
  tokens: TokenSupply[];
}

const normalizeAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const toBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  const raw = String(value ?? "").trim();
  return /^\d+$/.test(raw) ? BigInt(raw) : 0n;
};

const toDecimals = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 18;
};

/** Render a raw integer amount as a plain decimal number, without trailing zeros. */
export const formatUnits = (raw: bigint, decimals: number): string => {
  const sign = raw < 0n ? "-" : "";
  const abs = raw < 0n ? -raw : raw;
  if (decimals <= 0) return `${sign}${abs}`;

  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
};

/**
 * Active tokens for the reported symbols. A symbol that resolves to more than one
 * active token is dropped rather than guessed; STRATO prefers the configured address.
 */
const loadReportedTokens = async (accessToken: string): Promise<TokenRow[]> => {
  const response = await cirrus.get(accessToken, `/${Token}`, {
    params: {
      select: "address,_name,_symbol,_totalSupply::text,customDecimals",
      status: "eq.2",
      _symbol: `in.(${SUPPLY_TOKEN_SYMBOLS.join(",")})`,
    },
  });
  const rows: TokenRow[] = Array.isArray(response.data) ? response.data : [];
  const configuredStrato = normalizeAddress(config.stratoToken);

  const tokens: TokenRow[] = [];
  for (const symbol of SUPPLY_TOKEN_SYMBOLS) {
    let candidates = rows.filter((row) => row._symbol === symbol);
    if (symbol === "STRATO" && configuredStrato) {
      candidates = candidates.filter((row) => normalizeAddress(row.address) === configuredStrato);
    }
    if (candidates.length === 1) tokens.push(candidates[0]);
  }
  return tokens;
};

const loadBalances = async (
  accessToken: string,
  tokenAddresses: string[],
  holders: string[]
): Promise<Map<string, bigint>> => {
  const balances = new Map<string, bigint>();
  if (!tokenAddresses.length || !holders.length) return balances;

  const response = await cirrus.get(accessToken, `/${Token}-_balances`, {
    params: {
      address: `in.(${tokenAddresses.join(",")})`,
      key: `in.(${holders.join(",")})`,
      select: "address,key,value::text",
    },
  });
  for (const row of Array.isArray(response.data) ? response.data : []) {
    balances.set(`${normalizeAddress(row.address)}:${normalizeAddress(row.key)}`, toBigInt(row.value));
  }
  return balances;
};

const loadCustodyLocked = async (
  accessToken: string,
  tokenAddresses: string[]
): Promise<Map<string, bigint>> => {
  const locked = new Map<string, bigint>();
  const vault = normalizeAddress(config.stratoNativeCustodyVault);
  if (!vault || !tokenAddresses.length) return locked;

  const response = await cirrus.get(accessToken, `/${StratoNativeCustodyVault}-lockedBalance`, {
    params: {
      address: `eq.${vault}`,
      key: `in.(${tokenAddresses.join(",")})`,
      select: "key,value::text",
    },
  });
  for (const row of Array.isArray(response.data) ? response.data : []) {
    locked.set(normalizeAddress(row.key), toBigInt(row.value));
  }
  return locked;
};

export const getSupplyMetrics = async (accessToken: string): Promise<SupplyMetrics> => {
  const tokens = await loadReportedTokens(accessToken);
  const tokenAddresses = tokens.map((token) => normalizeAddress(token.address));

  const exclusionsBySymbol = new Map<string, SupplyExclusion[]>();
  const holders = new Set<string>();
  for (const token of tokens) {
    const symbol = token._symbol || "";
    const exclusions = [...getNonCirculatingAddresses(config.networkId, symbol), ...BURN_ADDRESSES];
    exclusionsBySymbol.set(symbol, exclusions);
    exclusions.forEach((exclusion) => holders.add(normalizeAddress(exclusion.address)));
  }

  const [balances, custodyLocked] = await Promise.all([
    loadBalances(accessToken, tokenAddresses, Array.from(holders)),
    loadCustodyLocked(accessToken, tokenAddresses),
  ]);

  const supplies = tokens.map((token): TokenSupply => {
    const address = normalizeAddress(token.address);
    const decimals = toDecimals(token.customDecimals);
    const totalSupply = toBigInt(token._totalSupply);

    const seen = new Set<string>();
    const nonCirculating: NonCirculatingBalance[] = [];
    let excluded = 0n;
    for (const exclusion of exclusionsBySymbol.get(token._symbol || "") || []) {
      const holder = normalizeAddress(exclusion.address);
      if (seen.has(holder)) continue;
      seen.add(holder);
      const balance = balances.get(`${address}:${holder}`) || 0n;
      if (balance === 0n) continue;
      excluded += balance;
      nonCirculating.push({ address: holder, label: exclusion.label, balance: balance.toString() });
    }

    const circulatingSupply = totalSupply > excluded ? totalSupply - excluded : 0n;

    return {
      symbol: token._symbol || "",
      name: token._name || token._symbol || address,
      address,
      decimals,
      totalSupply: totalSupply.toString(),
      circulatingSupply: circulatingSupply.toString(),
      totalSupplyFormatted: formatUnits(totalSupply, decimals),
      circulatingSupplyFormatted: formatUnits(circulatingSupply, decimals),
      nonCirculating,
      lockedInBridgeCustody: (custodyLocked.get(address) || 0n).toString(),
    };
  });

  return {
    timestamp: new Date().toISOString(),
    methodologyVersion: METHODOLOGY_VERSION,
    methodology: METHODOLOGY,
    tokens: supplies,
  };
};

/** Supply for one token, looked up by symbol (case-insensitive) or address. */
export const getTokenSupply = async (
  accessToken: string,
  identifier: string
): Promise<TokenSupply | null> => {
  const wanted = identifier.trim();
  if (!wanted) return null;

  const { tokens } = await getSupplyMetrics(accessToken);
  const byAddress = normalizeAddress(wanted);
  return (
    tokens.find((token) => token.symbol.toUpperCase() === wanted.toUpperCase()) ||
    tokens.find((token) => token.address === byAddress) ||
    null
  );
};
