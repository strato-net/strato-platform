import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { Token, EarningAsset } from "@mercata/shared-types";

const { tokenSelectFields, Token, CollateralVault, CDPEngine, DECIMALS } =
  constants;

export const getTokens = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
): Promise<{ tokens: Token[]; totalCount: number }> => {
  const params = Object.fromEntries(
    Object.entries(rawParams).filter(([key, v]) => v !== undefined)
  ) as Record<string, string>;

  const { limit, offset, select, ...countParams } = params;
  const countQuery = {
    ...countParams,
    select: select ? `count(),${select}` : "count()",
  };

  const [response, countResponse, rawPrices] = await Promise.all([
    cirrus.get(accessToken, "/" + Token, { params }),
    cirrus.get(accessToken, "/" + Token, { params: countQuery }),
    getCompletePriceMap(accessToken),
  ]);

  if (response.status !== 200 || !response.data) {
    throw new Error(`Error fetching tokens: ${response.statusText}`);
  }

  return {
    tokens: (response.data as any[]).map((token) => ({
      ...token,
      balance: token.balances?.[0]?.balance || "0",
      price: rawPrices.get(token.address) || "0",
    })) as Token[],
    totalCount: countResponse.data?.[0]?.count || 0,
  };
};

export const getEarningAssets = async (
  accessToken: string,
  userAddress: string
): Promise<EarningAsset[]> => {
  const [tokens, collaterals, cdps, rawPrices] = await Promise.all([
    cirrus.get(accessToken, "/" + Token, {
      params: {
        "balances.key": `eq.${userAddress}`,
        select: tokenSelectFields.join(","),
        status: "eq.2",
      },
    }),
    cirrus.get(accessToken, "/" + CollateralVault + "-userCollaterals", {
      params: {
        select: "user:key,asset:key2,amount:value::text",
        key: `eq.${userAddress}`,
        value: `gt.0`,
      },
    }),
    cirrus.get(accessToken, `/${CDPEngine}-vaults`, {
      params: {
        select: "user:key,asset:key2,amount:value->>collateral::text",
        key: `eq.${userAddress}`,
        "value->>collateral": `gt.0`,
      },
    }),
    getCompletePriceMap(accessToken),
  ]);

  const collateralMap = new Map<string, bigint>();
  [...(collaterals.data || []), ...(cdps.data || [])].forEach((item: any) =>
    collateralMap.set(
      item.asset,
      (collateralMap.get(item.asset) || 0n) + BigInt(item.amount || "0")
    )
  );

  return (tokens.data || []).map((t: any) => {
    const balance = t.balances?.[0]?.balance || "0";
    const price = rawPrices.get(t.address) || "0";
    const collateralBalance = (collateralMap.get(t.address) || 0n).toString();
    const totalBalance = BigInt(balance) + BigInt(collateralBalance);
    const value =
      price && price !== "0"
        ? (Number((totalBalance * BigInt(price)) / DECIMALS) / Number(DECIMALS)).toFixed(2)
        : "0.00";

    return {
      ...t,
      balance,
      price,
      collateralBalance,
      isPoolToken:
        t._symbol?.endsWith("-LP") ||
        t._symbol === "SUSDST" ||
        t._symbol === "MUSDST" ||
        t.description === "Liquidity Provider Token",
      value,
    };
  });
};
