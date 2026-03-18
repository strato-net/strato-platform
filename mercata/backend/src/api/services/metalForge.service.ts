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
  price: string;
}

export interface PayTokenConfig {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string;
  price: string;
}

export interface Config {
  metals: MetalConfig[];
  payTokens: PayTokenConfig[];
}

/**
 * Fetches MetalForge configuration: enabled metals, supported pay tokens,
 * mint caps, fees, total minted, and oracle prices.
 * Uses 2 Cirrus calls: 1 mapping (MetalForge configs + oracle prices) + 1 Token (metadata).
 */
export const getConfigs = async (
  accessToken: string
): Promise<Config> => {
  if (!constants.metalForge) {
    throw new Error("METAL_FORGE address not configured");
  }

  const mappingOr = `(and(address.eq.${constants.metalForge},collection_name.in.(metalConfigs,isSupportedPayToken,totalMinted)),and(address.eq.${constants.priceOracle},collection_name.eq.prices))`;
  const { data: mappingRows } = await cirrus.get(accessToken, "/mapping", { params: {
    select: "collection_name,key->>key,value::text", or: mappingOr,
  }});
  const metalConfigs: { addr: string; value: any }[] = [];
  const payTokenAddrs: string[] = [];
  const totalMintedMap = new Map<string, string>();
  const priceMap = new Map<string, string>();

  for (const r of mappingRows || []) {
    switch (r.collection_name) {
      case "metalConfigs":
        metalConfigs.push({ addr: r.key, value: typeof r.value === "string" ? JSON.parse(r.value) : r.value ?? {} });
        break;
      case "isSupportedPayToken":
        if (r.value === "true" || r.value === true) payTokenAddrs.push(r.key);
        break;
      case "totalMinted":
        totalMintedMap.set(r.key, String(r.value ?? "0"));
        break;
      case "prices":
        priceMap.set(r.key, r.value);
        break;
    }
  }

  // 1 Token call: metadata for all metal + pay token addresses
  const allAddresses = [...metalConfigs.map(m => m.addr), ...payTokenAddrs].filter(Boolean);
  const tokenInfoMap = new Map<string, { symbol: string; name: string; imageUrl: string }>();
  if (allAddresses.length > 0) {
    const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `in.(${allAddresses.join(",")})`,
        select: `address,_symbol,_name,images:${Token}-images(value)`,
      },
    });
    for (const t of tokenData || []) {
      tokenInfoMap.set(t.address, {
        symbol: t._symbol,
        name: t._name,
        imageUrl: t.images?.[0]?.value || "",
      });
    }
  }

  const metals: MetalConfig[] = metalConfigs.map(({ addr, value: v }) => {
    const info = tokenInfoMap.get(addr) || { symbol: addr, name: "", imageUrl: "" };
    return {
      address: addr,
      symbol: info.symbol,
      name: info.name,
      imageUrl: info.imageUrl,
      isEnabled: v.isEnabled ?? false,
      mintCap: String(v.mintCap ?? "0"),
      feeBps: String(v.feeBps ?? "0"),
      totalMinted: totalMintedMap.get(addr) || "0",
      price: priceMap.get(addr) || "0",
    };
  });

  const payTokens: PayTokenConfig[] = payTokenAddrs.map(addr => {
    const info = tokenInfoMap.get(addr) || { symbol: addr, name: "", imageUrl: "" };
    return {
      address: addr,
      symbol: info.symbol,
      name: info.name,
      imageUrl: info.imageUrl,
      price: priceMap.get(addr) || "0",
    };
  });

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
