import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { Token, EarningAsset, NetBalanceSnapshot } from "@mercata/shared-types";
import { buildTokenSelectFields } from "../../config/tokensConstants";

const { Token, CollateralVault, CDPEngine, DECIMALS } = constants;

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
        select: buildTokenSelectFields({
          images: true,
          attributes: true,
          balance: true,
        }).join(","),
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
        ? (
            Number((totalBalance * BigInt(price)) / DECIMALS) / Number(DECIMALS)
          ).toFixed(2)
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

interface HistoryElement {
  address: string;
  collection_name: string;
  key: any;
  path: string;
  value: any;
  valid_from: string;
  valid_to: string;
}

function updatePortfolioInfo(portfolioInfo: any, newInfo: HistoryElement): any {
  switch (newInfo.collection_name) {
    case '_balances': {
      console.log(`_balances ${newInfo.valid_from}: ${newInfo.address}`)
      const currentBalance = portfolioInfo.balances[newInfo.address] || 0;
      const newValue = newInfo.value || 0;
      return { ...portfolioInfo,
        balances: { ...portfolioInfo.balances,
          [newInfo.address]: currentBalance + newValue
        }
      };
    } 
    case 'prices': {
      const newValue = newInfo.value || 0;
      return { ...portfolioInfo,
        prices: { ...portfolioInfo.prices,
          [newInfo.key['key'] || '']: newValue
        }
      };
    }
    case 'vaults': {
      console.log(`vaults ${newInfo.valid_from}: ${newInfo.key['key2']}`)
      const scaledDebt = parseInt(newInfo.value.scaledDebt) || 0;
      return { ...portfolioInfo, 
        userLoan: portfolioInfo.userLoan + scaledDebt
      };
    }
    case 'userCollaterals': {
      console.log(`userCollaterals ${newInfo.valid_from}: ${newInfo.key['key2']}`)
      const token = newInfo.key['key2'] || '';
      const currentBalance = portfolioInfo.balances[token] || 0;
      const newValue = newInfo.value || 0;
      return { ...portfolioInfo, 
        balances: { ...portfolioInfo.balances,
          [token]: currentBalance + newValue
        }
      };
    }
    case 'userLoan': {
      return { ...portfolioInfo, 
        userLoan: portfolioInfo.userLoan + parseInt(newInfo.value['scaledDebt'])
      };
    }
  }
  return portfolioInfo;
}

export const getBalanceHistory = async (
  accessToken: string,
  userAddress: string,
  endTimestamp: number,
  interval: number,
  numTicks: number,
): Promise<NetBalanceSnapshot[]> => {
  const startTimestamp = endTimestamp - (interval * numTicks);
  const startTime = (new Date(startTimestamp)).toISOString();
  const endTime = (new Date(endTimestamp)).toISOString();
  const res = await cirrus.get(accessToken, "/history@mapping", {
    params: {
      and: `(or(path.like.*${userAddress}*,path.like.prices[*),or(valid_from.lte.${endTime},valid_to.gte.${startTime}))`,
      collection_name: `in.(${['_balances', 'prices', 'userCollaterals', 'userLoan', 'vaults'].join(',')})`,
      select: 'address,collection_name,key,path,value,valid_from,valid_to'
    },
  });
  const history = res.data as HistoryElement[];
  const snapshots: any[] = (new Array(numTicks + 1)).fill({}).map((_, i) => { return {
    timestamp: endTimestamp - (interval * (numTicks - i)),
    portfolioInfo: { balances: {}, prices: {}, userLoan: 0 }
  }; });
  history.forEach((h) => {
    const validFrom = Date.parse(h.valid_from);
    const validTo = h.valid_to === 'infinity' ? Number.MAX_SAFE_INTEGER : Date.parse(h.valid_to);
    if (validFrom <= startTimestamp && validTo >= endTimestamp) {
      for (let i = 0; i < snapshots.length; i++) {
        snapshots[i].portfolioInfo = updatePortfolioInfo(snapshots[i].portfolioInfo, h);
      }
    } else if (validFrom <= startTimestamp) {
      for (let i = 0; i < snapshots.length; i++) {
        if (snapshots[i].timestamp <= validTo) {
          snapshots[i].portfolioInfo = updatePortfolioInfo(snapshots[i].portfolioInfo, h);
        } else {
          break;
        }
      }
    } else if (validTo >= endTimestamp) {
      for (let i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].timestamp >= validFrom) {
          snapshots[i].portfolioInfo = updatePortfolioInfo(snapshots[i].portfolioInfo, h);
        } else {
          break;
        }
      }
    } else {
      for (let i = 0; i < snapshots.length; i++) {
        if (snapshots[i].timestamp >= validFrom && snapshots[i].timestamp <= validTo) {
          snapshots[i].portfolioInfo = updatePortfolioInfo(snapshots[i].portfolioInfo, h);
        }
        if (snapshots[i].timestamp > validTo) {
          break;
        }
      }
    }
  });

  const balanceHistory = snapshots.map((snapshot, i) => {
    let netBalance = 0;
    for (const token in snapshot.portfolioInfo.prices) {
      const tokenPrice = snapshot.portfolioInfo.prices[token] || 0;
      const tokenBalance = snapshot.portfolioInfo.balances[token] || 0;
      if (tokenPrice === 0 || tokenBalance === 0) {
        console.log(`balance ${snapshot.timestamp} ${token}: ${tokenPrice} ${tokenBalance}`)
        continue;
      }
      const tokenValue = (tokenPrice / 1000000000) * (tokenBalance / 1000000000);
      console.log(`balance ${snapshot.timestamp} ${token}: ${tokenPrice} ${tokenBalance} ${tokenValue}`)
      netBalance += tokenValue;
    }
    console.log(`user loan ${snapshot.timestamp}: ${snapshot.portfolioInfo.userLoan}`)
    netBalance -= snapshot.portfolioInfo.userLoan || 0;
    return { timestamp: snapshot.timestamp, netBalance: netBalance / 1e18 }
  });

  return balanceHistory;
};