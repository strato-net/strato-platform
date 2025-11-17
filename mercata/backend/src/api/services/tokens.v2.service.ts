import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { Token, EarningAsset } from "@mercata/shared-types";

const { tokensV2SelectFields, tokensV2BalancesField, tokenSelectFields, Token, CollateralVault, CDPEngine, DECIMALS } = constants;

// Get tokens v2 - no collateral data
export const getTokens = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
): Promise<{ tokens: Token[]; totalCount: number }> => {
  const params = Object.fromEntries(
    Object.entries(rawParams).filter(([key, v]) => v !== undefined && key !== "select")
  ) as Record<string, string>;

  const hasBalanceFilter = Object.keys(params).some(key => key.startsWith("balances."));
  const selectFields = hasBalanceFilter 
    ? [...tokensV2SelectFields, tokensV2BalancesField]
    : tokensV2SelectFields;

  params.select = selectFields.join(",");
  const { limit, offset, ...countParams } = params;
  const countQuery = {
    ...countParams,
    select: hasBalanceFilter ? `count(),${tokensV2BalancesField}` : "count()",
  };

  const [response, countResponse, rawPrices] = await Promise.all([
    cirrus.get(accessToken, "/" + Token, { params }),
    cirrus.get(accessToken, "/" + Token, { params: countQuery }),
    getCompletePriceMap(accessToken)
  ]);

  if (response.status !== 200 || !response.data) {
    throw new Error(`Error fetching tokens: ${response.statusText}`);
  }

  const totalCount = countResponse.data?.[0]?.count || 0;
  const tokens = (response.data as any[]).map((token) => ({
    ...token,
    balance: token.balances?.[0]?.balance || "0",
    price: rawPrices.get(token.address) || "0",
  })) as Token[];

  return { tokens, totalCount };
};

// Get earning assets v2
export const getEarningAssets = async (accessToken: string, userAddress: string): Promise<EarningAsset[]> => {
  const params = {
    "balances.key": `eq.${userAddress}`,
    select: tokenSelectFields.join(","),
    status: "eq.2",
  } as Record<string, string>;

  const [tokens, collaterals, cdps, rawPrices] = await Promise.all([
    cirrus.get(accessToken, "/" + Token, { params }),
    cirrus.get(accessToken, "/" + CollateralVault + "-userCollaterals", {
      params: {
        select: "user:key,asset:key2,amount:value::text",
        key: `eq.${userAddress}`,
        value: `gt.0`
      }
    }),
    cirrus.get(accessToken, `/${CDPEngine}-vaults`, {
      params: {
        select: "user:key,asset:key2,amount:value->>collateral::text",
        key: `eq.${userAddress}`,
        "value->>collateral": `gt.0`
      }
    }),
    getCompletePriceMap(accessToken)
  ]);

  const collateralMap = new Map<string, bigint>();
  for (const c of collaterals.data || [])
    collateralMap.set(c.asset, BigInt(c.amount));
  for (const v of cdps.data || [])
    collateralMap.set(
      v.asset,
      (collateralMap.get(v.asset) || 0n) + BigInt(v.amount || "0")
    );

  const tokenData = tokens.data || [];
  
  return tokenData.map((t: any) => {
    const isPoolToken = 
      t._symbol?.endsWith("-LP") || 
      t._symbol === "SUSDST" || 
      t._symbol === "MUSDST" ||
      t.description === "Liquidity Provider Token";
    
    const balance = t.balances?.[0]?.balance || "0";
    const price = rawPrices.get(t.address) || "0";
    const collateralBalance = (collateralMap.get(t.address) || 0n).toString();
    
    let value = "0.00";
    if (price && price !== "0") {
      try {
        const balanceBigInt = BigInt(balance);
        const collateralBigInt = BigInt(collateralBalance);
        const priceBigInt = BigInt(price);
        const totalBalance = balanceBigInt + collateralBigInt;
        const valueWei = (totalBalance * priceBigInt) / DECIMALS;
        const valueDecimal = Number(valueWei) / Number(DECIMALS);
        value = valueDecimal.toFixed(2);
      } catch (error) {
        value = "0.00";
      }
    }
    
    return {
      ...t,
      balance,
      price,
      collateralBalance,
      isPoolToken,
      value,
    };
  });
};

