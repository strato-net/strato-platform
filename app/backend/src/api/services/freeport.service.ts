import { cirrus } from "../../utils/appApiHelper";
import * as config from "../../config/config";
import { FREEPORT_TOKEN_FIELDS } from "../../config/tokensConstants";
import { Token } from "@strato/shared-types";

// FreeportToken is a standalone contract (not BlockApps-Token), so map its rows onto the Token shape.
const toToken = (t: any): Token => ({
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
  images: [],
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
  return (data || []).map(toToken);
};
