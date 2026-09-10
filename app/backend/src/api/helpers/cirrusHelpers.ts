import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";

const { SaveUSDSTVault, Token } = constants;

export const toUTCTime = (d: Date) => d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');

// The /mapping table key column is a JSON object of the form
// {key, key2, key3, ...}; return the parts as an ordered list.
export const getMappingKeyParts = (key: any): string[] => {
  if (key && typeof key === "object") {
    const parts: string[] = [];
    for (let i = 1; ; i++) {
      const part = (key as any)[i === 1 ? "key" : `key${i}`];
      if (part === undefined || part === null) break;
      parts.push(String(part));
    }
    return parts;
  }
  const single = String(key ?? "");
  return single.length > 0 ? [single] : [];
};

// Struct values with array fields are split across /mapping rows: the row keyed
// by the collection's mapping key(s) holds the scalar fields (with a zero
// placeholder where each array field would be), a row with one extra key part
// holds an array's length, and rows with two extra key parts hold one array
// element each (e.g. deposits[<addr>] / deposits[<addr>].tokens /
// deposits[<addr>].tokens[0]). Given all rows of one collection, rebuild each
// struct with its array fields in place. `keyDepth` is the number of mapping
// keys of the collection; map keys of the result join the key parts with "\0"
// when keyDepth > 1.
export const reassembleMappingStructRows = (
  rows: any[],
  keyDepth: number = 1
): Map<string, any> => {
  const structs = new Map<string, any>();
  const arrays = new Map<string, Map<string, { idx: number; value: any }[]>>();

  const parseValue = (value: any): any => {
    if (value && typeof value === "object") return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  };

  for (const row of rows ?? []) {
    const parts = getMappingKeyParts(row.key);
    if (parts.length < keyDepth) continue; // array-length marker of an array-keyed collection
    const mapKey = parts.slice(0, keyDepth).join("\0");

    if (parts.length === keyDepth) {
      structs.set(mapKey, { ...(structs.get(mapKey) ?? {}), ...parseValue(row.value) });
    } else if (parts.length === keyDepth + 2) {
      const fieldName = parts[keyDepth];
      const idx = Number(parts[keyDepth + 1]);
      if (!Number.isFinite(idx)) continue;
      let element = row.value;
      if (typeof element === "string") {
        try {
          element = JSON.parse(element);
        } catch {
          // raw scalar element (e.g. an address) — keep as-is
        }
      }
      const fields = arrays.get(mapKey) ?? new Map<string, { idx: number; value: any }[]>();
      const elems = fields.get(fieldName) ?? [];
      elems.push({ idx, value: element });
      fields.set(fieldName, elems);
      arrays.set(mapKey, fields);
    }
    // parts.length === keyDepth + 1 is an array-length row: nothing to extract.
    // Deeper rows (arrays nested inside array elements) are not reassembled.
  }

  for (const [mapKey, fields] of arrays) {
    const struct = structs.get(mapKey) ?? {};
    for (const [fieldName, elems] of fields) {
      struct[fieldName] = elems.sort((a, b) => a.idx - b.idx).map((e) => e.value);
    }
    structs.set(mapKey, struct);
  }

  return structs;
};

export const fetchTokenBalances = (accessToken: string, userAddress: string, tokenAddrs: string[]) =>
  cirrus.get(accessToken, `/${constants.Token}-_balances`, {
    params: { 
      select: "address,balance:value::text", 
      key: `eq.${userAddress}`, 
      address: `in.(${tokenAddrs.join(",")})` 
    }
  }).then((r: any) => new Map<string, bigint>(r.data.map((b: any) => [b.address, BigInt(b.balance || "0")])));

export const getTokenMetadata = async (accessToken: string, tokenAddresses: string[]) => {
  if (!tokenAddresses.length) return new Map();

  const normalizedAddresses = tokenAddresses.map((address) => address.toLowerCase().replace(/^0x/, ""));
  const saveUsdstVault = constants.saveUsdstVault?.toLowerCase().replace(/^0x/, "");
  const [tokenResponse, saveUsdstResponse] = await Promise.all([
    cirrus.get(accessToken, `/${Token}`, {
      params: { select: `address,_name,_symbol,status,images:${Token}-images(value)`, address: `in.(${normalizedAddresses.join(",")})` }
    }),
    saveUsdstVault && normalizedAddresses.includes(saveUsdstVault)
      ? cirrus.get(accessToken, `/${SaveUSDSTVault}`, {
          params: {
            address: `eq.${saveUsdstVault}`,
            select: "address,_name,_symbol,vaultInitialized",
            limit: "1",
          }
        })
      : Promise.resolve({ data: [] }),
  ]);

  const metadata = new Map(
    (tokenResponse.data || []).map((token: any) => [
      token.address.toLowerCase().replace(/^0x/, ""),
      { name: token._name, symbol: token._symbol, status: token.status, image: token.images?.[0]?.value }
    ])
  );

  for (const vault of saveUsdstResponse.data || []) {
    const initialized = vault.vaultInitialized === true || vault.vaultInitialized === "true";
    metadata.set(vault.address.toLowerCase().replace(/^0x/, ""), {
      name: vault._name || "Save USDST Vault",
      symbol: vault._symbol || "saveUSDST",
      status: initialized ? "2" : "1",
      image: undefined,
    });
  }

  return metadata;
};

export const getTokenDetails = async (
  accessToken: string,
  tokenAddresses: string[]
) => {
  if (!tokenAddresses.length) return new Map();

  const { data: tokenData } = await cirrus.get(
    accessToken,
    `/${Token}`,
    {
      params: {
        select:
          `address,_name,_symbol,_owner,_totalSupply::text,customDecimals,description,status,_paused,images:${Token}-images(value),attributes:${Token}-attributes(key,value)`,
        address: `in.(${tokenAddresses.join(",")})`,
      },
    }
  );

  return new Map(tokenData.map((token: any) => [token.address, token]));
};

