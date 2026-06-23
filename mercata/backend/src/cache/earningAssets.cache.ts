import { constants } from "../config/constants";
import { buildTokenSelectFields } from "../config/tokensConstants";
import { cirrus } from "../utils/mercataApiHelper";
import { getCompletePriceMap } from "../api/helpers/oracle.helper";
import { getRebaseFactors } from "../api/services/oracle.service";
import { getSaveUsdstInfo, getSaveUsdstUserInfo } from "../api/services/saveUsdst.service";
import { getVaultShareTokenAddress } from "../api/services/vault.service";
import { getYieldVaultInfo, getYieldVaultUserInfo } from "../api/services/yieldVault.service";

const { Token, CollateralVault, CDPEngine, MercataBridge, mercataBridge } = constants;

const EARNING_ASSETS_CACHE_TTL_MS = 30_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

const normalizeAddress = (address: string): string => address.toLowerCase();

const normalizeAddressList = (addresses: string[]): string =>
  addresses.map(normalizeAddress).sort().join(",");

function getCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) return cached.value;

  const value = fetcher().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { expiresAt: now + EARNING_ASSETS_CACHE_TTL_MS, value });
  return value;
}

function getCachedByUser<T>(
  keyPrefix: string,
  userAddress: string | undefined,
  fetcher: () => Promise<T>
): Promise<T> {
  const cacheUser = userAddress ? normalizeAddress(userAddress) : "default";
  return getCached(`${keyPrefix}:${cacheUser}`, fetcher);
}

export const getCachedEarningAssetTokens = async (
  accessToken: string,
  userAddress: string | undefined
) => getCachedByUser("tokens", userAddress, () =>
  cirrus.get(accessToken, "/" + Token, {
    params: {
      "balances.key": `eq.${userAddress}`,
      select: buildTokenSelectFields({
        images: true,
        attributes: true,
        balance: true,
      }).join(","),
      status: "eq.2",
    },
  })
);

export const getCachedEarningAssetCollaterals = async (
  accessToken: string,
  userAddress: string | undefined
) => getCachedByUser("collaterals", userAddress, () =>
  cirrus.get(accessToken, "/" + CollateralVault + "-userCollaterals", {
    params: {
      select: "user:key,asset:key2,amount:value::text",
      key: `eq.${userAddress}`,
      value: `gt.0`,
    },
  })
);

export const getCachedEarningAssetCdps = async (
  accessToken: string,
  userAddress: string | undefined
) => getCachedByUser("cdps", userAddress, () =>
  cirrus.get(accessToken, `/${CDPEngine}-vaults`, {
    params: {
      select: "user:key,asset:key2,amount:value->>collateral::text",
      key: `eq.${userAddress}`,
      "value->>collateral": `gt.0`,
    },
  })
);

export const getCachedEarningAssetPrices = async (accessToken: string) =>
  getCached("prices", () => getCompletePriceMap(accessToken));

export const getCachedVaultShareTokenAddress = async (accessToken: string) =>
  getCached("vault-share-token", () => getVaultShareTokenAddress(accessToken));

export const getCachedSaveUsdstInfo = async (accessToken: string) =>
  getCached("save-usdst-info", () => getSaveUsdstInfo(accessToken));

export const getCachedSaveUsdstUserInfo = async (
  accessToken: string,
  userAddress: string | undefined
) => getCachedByUser("save-usdst-user", userAddress, () =>
  getSaveUsdstUserInfo(accessToken, userAddress!)
);

export const getCachedRebaseFactors = async (accessToken: string) =>
  getCached("rebase-factors", () => getRebaseFactors(accessToken));

export const getCachedRebasingExternalSymbols = async (
  accessToken: string,
  stratoTokenAddresses: string[]
): Promise<Map<string, string>> => {
  if (!stratoTokenAddresses.length || !mercataBridge) return new Map();

  return getCached(`rebasing-symbols:${normalizeAddressList(stratoTokenAddresses)}`, async () => {
    const { data } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, {
      params: {
        address: `eq.${mercataBridge}`,
        "value->>stratoToken": `in.(${stratoTokenAddresses.join(",")})`,
        select: "value->>stratoToken,value->>externalSymbol",
      },
    }).catch(() => ({ data: [] }));

    const symbolsByToken = new Map<string, Set<string>>();
    for (const row of data || []) {
      const stratoToken = (row.stratoToken || "").toLowerCase().replace(/^0x/, "");
      const sym: string = row.externalSymbol;
      if (!stratoToken || !sym) continue;
      if (!symbolsByToken.has(stratoToken)) symbolsByToken.set(stratoToken, new Set());
      symbolsByToken.get(stratoToken)!.add(sym);
    }

    const result = new Map<string, string>();
    for (const [stratoToken, symbols] of symbolsByToken) {
      if (symbols.size === 1) result.set(stratoToken, [...symbols][0]);
    }
    return result;
  });
};

export const getCachedYieldVaultInfo = async (
  accessToken: string,
  key: string
) => getCached(`yield-vault-info:${key}`, () => getYieldVaultInfo(accessToken, key));

export const getCachedYieldVaultUserInfo = async (
  accessToken: string,
  key: string,
  userAddress: string | undefined
) => getCachedByUser(`yield-vault-user:${key}`, userAddress, () =>
  getYieldVaultUserInfo(accessToken, key, userAddress!)
);
