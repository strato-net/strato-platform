import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { StratoPaths, constants } from "../../config/constants";

const { MetalForge, Token } = constants;

export interface MetalConfig {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string;
  isEnabled: boolean;
  mintCap: string;
  feeBps: string;
  totalMinted: string;
}

export interface PayTokenConfig {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string;
}

export interface Config {
  metals: MetalConfig[];
  payTokens: PayTokenConfig[];
}

/**
 * Cirrus response shape for a struct-valued mapping row:
 *   { address, key, value: { field1, field2, ... }, block_hash, ... }
 *
 * For a uint-valued mapping row:
 *   { address, key, value: <number|string>, block_hash, ... }
 */

export const getConfigs = async (
  accessToken: string
): Promise<Config> => {
  if (!constants.metalForge) {
    throw new Error("METAL_FORGE address not configured");
  }

  const [
    { data: metalConfigRows },
    { data: payTokenConfigRows },
    { data: totalMintedRows },
  ] = await Promise.all([
    cirrus.get(accessToken, `/${MetalForge}-metalConfigs`, {
      params: { address: `eq.${constants.metalForge}`, select: "key,value::text" },
    }),
    cirrus.get(accessToken, `/${MetalForge}-isSupportedPayToken`, {
      params: { address: `eq.${constants.metalForge}`, select: "key,value::text" },
    }),
    cirrus.get(accessToken, `/${MetalForge}-totalMinted`, {
      params: { address: `eq.${constants.metalForge}`, select: "key,value::text" },
    }),
  ]);

  const parseStructValue = (raw: any): Record<string, any> => {
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw ?? {};
  };

  const totalMintedMap = new Map<string, string>(
    (totalMintedRows || []).map((r: any) => [r.key, String(r.value ?? "0")])
  );

  const allAddresses = [
    ...(metalConfigRows || []).map((r: any) => r.key),
    ...(payTokenConfigRows || []).map((r: any) => r.key),
  ].filter(Boolean);

  const tokenInfoMap = new Map<string, { symbol: string; name: string; imageUrl: string }>();
  if (allAddresses.length > 0) {
    const { data: tokens } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `in.(${allAddresses.join(",")})`,
        select: `address,_symbol,_name,images:${Token}-images(value)`,
      },
    });
    for (const t of tokens || []) {
      tokenInfoMap.set(t.address, {
        symbol: t._symbol,
        name: t._name,
        imageUrl: t.images?.[0]?.value || "",
      });
    }
  }

  const metals: MetalConfig[] = (metalConfigRows || []).map((r: any) => {
    const tokenAddr = r.key;
    const v = parseStructValue(r.value);
    const info = tokenInfoMap.get(tokenAddr) || { symbol: tokenAddr, name: "", imageUrl: "" };
    return {
      address: tokenAddr,
      symbol: info.symbol,
      name: info.name,
      imageUrl: info.imageUrl,
      isEnabled: v.isEnabled ?? false,
      mintCap: String(v.mintCap ?? "0"),
      feeBps: String(v.feeBps ?? "???"),
      totalMinted: totalMintedMap.get(tokenAddr) || "0",
    };
  });

  const payTokens: PayTokenConfig[] = (payTokenConfigRows || []).map((r: any) => {
    const tokenAddr = r.key;
    const isSupported = r.value === true || r.value === "true";
    if (!isSupported) return null;
    const info = tokenInfoMap.get(tokenAddr) || { symbol: tokenAddr, name: "", imageUrl: "" };
    return {
      address: tokenAddr,
      symbol: info.symbol,
      name: info.name,
      imageUrl: info.imageUrl,
    };
  }).filter(Boolean) as PayTokenConfig[];

  return { metals, payTokens };
};

export const mintMetal = async (
  accessToken: string,
  userAddress: string,
  body: { metalToken: string; payToken: string; payAmount: string; minMetalOut: string }
): Promise<{ status: string; hash: string }> => {
  if (!constants.metalForge) {
    throw new Error("METAL_FORGE address not configured");
  }

  const { metalToken, payToken, payAmount, minMetalOut } = body;

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: payToken,
      method: "approve",
      args: { spender: constants.metalForge, value: payAmount },
    },
    {
      contractName: extractContractName(MetalForge),
      contractAddress: constants.metalForge,
      method: "mintMetal",
      args: { metalToken, payToken, payAmount, minMetalOut },
    },
  ];

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};
