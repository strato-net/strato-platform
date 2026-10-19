import axios from "axios";
import { cirrus } from "../../utils/appApiHelper";
import * as config from "../../config/config";
import { FREEPORT_TOKEN_FIELDS, IPFS_GATEWAY, evmLogoUrl } from "../../config/tokensConstants";
import { Token } from "@strato/shared-types";

const toHttp = (uri: string) => uri.replace(/^ipfs:\/\//, IPFS_GATEWAY);

// Logo lookups rarely change, so results are cached; network failures are retried next time.
const logoCache = new Map<string, Promise<string>>();
const cachedLogo = (key: string, resolve: () => Promise<string>): Promise<string> => {
  if (!logoCache.has(key)) {
    logoCache.set(key, resolve().catch(() => { logoCache.delete(key); return ""; }));
  }
  return logoCache.get(key)!;
};

const getMetadataImage = (uri: string) =>
  cachedLogo(uri, () => axios.get(toHttp(uri), { timeout: 5000 })
    .then(({ data }) => (typeof data?.image === "string" ? toHttp(data.image) : "")));

// Ported EVM coins use their origin token's public logo; originToken holds the address in its low 160 bits.
const getEvmLogo = (chainId: string, originToken: string) => {
  const url = evmLogoUrl(chainId, "0x" + (BigInt(originToken) & ((1n << 160n) - 1n)).toString(16).padStart(40, "0"));
  return cachedLogo(url, () => axios.head(url, { timeout: 5000, validateStatus: () => true })
    .then(({ status }) => (status === 200 ? url : "")));
};

const isEvmChain = (chainId: string) => chainId !== "0" && Number.isSafeInteger(Number(chainId));

// Launchpad coins keep their metadata URI in Launchpad.uriOf, keyed by (issuer, creatorNonce).
const getLaunchpadUris = async (accessToken: string, native: any[]): Promise<Map<string, string>> => {
  if (!config.launchpadUriTable || !native.length) return new Map();
  const { data } = await cirrus.get(accessToken, `/${config.launchpadUriTable}`, {
    params: {
      or: `(${native.map((t) => `and(address.eq.${t.issuer},key.eq.${t.creatorNonce})`).join(",")})`,
      select: "address,key::text,value",
    },
  });
  return new Map((data || []).map((r: any) => [`${r.address}:${r.key}`, r.value]));
};

const getLogos = async (accessToken: string, rows: any[]): Promise<Map<string, string>> => {
  const native = rows.filter((t) => Number(t.nativeFlag) === 1 && t.issuer);
  const uriOf = await getLaunchpadUris(accessToken, native).catch(() => new Map<string, string>());
  const logos = await Promise.all(rows.map(async (t) => {
    if (Number(t.nativeFlag) === 1) {
      const uri = uriOf.get(`${t.issuer}:${t.creatorNonce}`);
      return [t.address, uri ? await getMetadataImage(uri) : ""] as const;
    }
    return [t.address, isEvmChain(t.originChainId) ? await getEvmLogo(t.originChainId, t.originToken) : ""] as const;
  }));
  return new Map(logos.filter(([, image]) => image));
};

// FreeportToken is a standalone contract (not BlockApps-Token), so map its rows onto the Token shape.
const toToken = (t: any, image?: string): Token => ({
  address: t.address,
  _name: t.name,
  _symbol: t.symbol,
  _owner: "",
  _totalSupply: t.totalSupply,
  customDecimals: Number(t.decimals),
  description: Number(t.nativeFlag) === 1
    ? "Freeport native token"
    : `Ported via Freeport from chain ${t.originChainId}`,
  status: "2",
  _paused: false,
  balance: t.balances?.[0]?.value || "0",
  images: image ? [{ value: image }] : [],
  attributes: [],
  price: "0",
});

// Tokens registered by this network's Freeport; with a userAddress, only those the user holds.
export const getFreeportTokens = async (
  accessToken: string,
  params: Record<string, string> = {},
  userAddress?: string
): Promise<Token[]> => {
  const { freeport, freeportTokenTable } = config;
  if (!freeport) return [];
  const { data } = await cirrus.get(accessToken, `/${freeportTokenTable}`, {
    params: {
      ...params,
      bridge: `eq.${freeport}`,
      select: [
        ...FREEPORT_TOKEN_FIELDS,
        ...(userAddress ? [`balances:${freeportTokenTable}-balances!inner(value::text)`] : []),
      ].join(","),
      ...(userAddress ? { "balances.key": `eq.${userAddress}`, "balances.value": "gt.0" } : {}),
    },
  });
  const rows = data || [];
  const logos = await getLogos(accessToken, rows).catch(() => new Map<string, string>());
  return rows.map((t: any) => toToken(t, logos.get(t.address)));
};

export const isFreeportToken = async (accessToken: string, address?: string | null): Promise<boolean> => {
  const { freeport, freeportTokenTable } = config;
  if (!freeport || !address) return false;
  const { data } = await cirrus.get(accessToken, `/${freeportTokenTable}`, {
    params: { address: `eq.${address}`, bridge: `eq.${freeport}`, select: "address" },
  });
  return (data || []).length > 0;
};
