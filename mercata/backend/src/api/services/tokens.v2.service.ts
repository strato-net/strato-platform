import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { Token, EarningAsset, NetBalanceSnapshot } from "@mercata/shared-types";
import { buildTokenSelectFields } from "../../config/tokensConstants";
import { getHistory, HistoryParams, MappingHistoryElement, StorageHistoryElement } from "../helpers/history.helper";
import { calculateLPTokenPrice } from "../helpers/swapping.helper";

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

function updatePortfolioInfoStorage(portfolioInfo: any, newInfo: StorageHistoryElement): any {
  if (newInfo.data._symbol) {
    const totalSupply = newInfo.data._totalSupply || '0';
    return { ...portfolioInfo,
      tokens: { ...portfolioInfo.tokens,
        [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
          supply: totalSupply
        }
      }
    };
  } else if (newInfo.data.lpToken) {
    return { ...portfolioInfo,
      tokens: { ...portfolioInfo.tokens,
        [newInfo.data.lpToken]: { ...portfolioInfo.tokens[newInfo.data.lpToken],
          pool: newInfo.data
        }
      }
    };
  } else if (newInfo.data.mToken) {
    return { ...portfolioInfo,
      tokens: { ...portfolioInfo.tokens,
        [newInfo.data.mToken]: { ...portfolioInfo.tokens[newInfo.data.mToken],
          borrowIndex: BigInt(newInfo.data.borrowIndex || '') || 0n,
          borrowableAsset: newInfo.data.borrowableAsset,
          reservesAccrued: BigInt(newInfo.data.reservesAccrued || '') || 0n,
          totalScaledDebt: BigInt(newInfo.data.totalScaledDebt || '') || 0n,
          badDebt: BigInt(newInfo.data.badDebt || '') || 0n
        }
      }
    };
  } else if (newInfo.data.sToken) {
    return { ...portfolioInfo,
      tokens: { ...portfolioInfo.tokens,
        [newInfo.data.sToken]: { ...portfolioInfo.tokens[newInfo.data.sToken],
          managedAssets: BigInt(newInfo.data._managedAssets || 0n)
        }
      }
    };
  }
  return portfolioInfo;
}

function updatePortfolioInfoMapping(portfolioInfo: any, newInfo: MappingHistoryElement): any {
  switch (newInfo.collection_name) {
    case '_balances': {
      const currentBalance = portfolioInfo.tokens[newInfo.address]?.balance || 0;
      const newValue = parseFloat(newInfo.value) || newInfo.value || 0;
      if (newInfo.path === '_balances[0000000000000000000000000000000000001004]') {
        return { ...portfolioInfo, 
          tokens: { ...portfolioInfo.tokens,
            [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
              liquidityPoolBalance: newValue
            }
          }
        };
      }
      return { ...portfolioInfo, 
        tokens: { ...portfolioInfo.tokens,
          [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
            balance: currentBalance + newValue
          }
        }
      };
    } 
    case 'prices': {
      const newValue = newInfo.value || 0;
      return { ...portfolioInfo,
        tokens: { ...portfolioInfo.tokens,
          [newInfo.key['key'] || '']: { ...portfolioInfo.tokens[newInfo.key['key'] || ''],
            price: newValue
          }
        }
      };
    }
    case 'collateralConfigs': {
      const stabilityFeeRate = parseFloat(newInfo.value.stabilityFeeRate) || 0;
      return { ...portfolioInfo, 
        tokens: { ...portfolioInfo.tokens,
          [newInfo.key['key'] || '']: { ...portfolioInfo.tokens[newInfo.key['key'] || ''],
            stabilityFeeRate: stabilityFeeRate
          }
        }
      };
    }
    case 'collateralGlobalStates': {
      const rateAccumulator = parseFloat(newInfo.value.rateAccumulator) || 0;
      const lastAccrual = parseFloat(newInfo.value.lastAccrual) || 0;
      return { ...portfolioInfo, 
        tokens: { ...portfolioInfo.tokens,
          [newInfo.key['key'] || '']: { ...portfolioInfo.tokens[newInfo.key['key'] || ''],
            rateAccumulator: rateAccumulator,
            lastAccrual: lastAccrual
          }
        }
      };
    }
    case 'vaults': {
      const scaledDebt = parseFloat(newInfo.value.scaledDebt) || 0;
      return { ...portfolioInfo, 
        tokens: { ...portfolioInfo.tokens,
          [newInfo.key['key2'] || '']: { ...portfolioInfo.tokens[newInfo.key['key2'] || ''],
            scaledDebt: scaledDebt
          }
        }
      };
    }
    case 'userCollaterals': {
      const token = newInfo.key['key2'] || '';
      const currentBalance = portfolioInfo.tokens[token]?.balance || 0;
      const newValue = newInfo.value || 0;
      return { ...portfolioInfo, 
        tokens: { ...portfolioInfo.tokens,
          [token]: { ...portfolioInfo.tokens[token],
            balance: currentBalance + newValue
          }
        }
      };
    }
    case 'userLoan': {
      return { ...portfolioInfo, 
        userLoan: { ...portfolioInfo.userLoan,
          scaledDebt: newInfo.value['scaledDebt'],
          lastUpdated: newInfo.value['lastUpdated']
        }
      };
    }
  }
  return portfolioInfo;
}

function processBalanceSnapshot(snapshot: {timestamp: number, data: any}, index: number): {timestamp: number, data: any} {
  let netBalance: number = 0;
  let netLoan: number = 0;
  for (const tokenAddr in snapshot.data.tokens) {
    const token = snapshot.data.tokens[tokenAddr] || {};
    let tokenPrice = token?.price || 0;
    const tokenBalance = token?.balance || 0;
    if (token?.scaledDebt) {
      const rateAccumulator = Number(BigInt(token?.rateAccumulator) / 1000000000000000000n) / 1000000000;
      const loanAmt = (token?.scaledDebt || 0) * rateAccumulator;
      netLoan += loanAmt;
    }
    if (tokenBalance === 0) continue;
    if (tokenPrice === 0) {
      const totalSupply = token?.supply || '0';
      if (totalSupply === '0') continue;
      const pool = token?.pool;
      const managedAssets = token?.managedAssets;
      if (pool) { // LP token
        tokenPrice = calculateLPTokenPrice(
          pool.tokenABalance,
          pool.tokenBBalance,
          snapshot.data.tokens[pool.tokenA]?.price || '0',
          snapshot.data.tokens[pool.tokenB]?.price || '0',
          totalSupply
        );
      } else if (managedAssets) { // sUSDST
        tokenPrice = Number((managedAssets * BigInt(1e18)) / BigInt(totalSupply));
      } else { // mUSDST
        const borrowIndex = BigInt(token?.borrowIndex) || 0n;
        const borrowableAsset = token?.borrowableAsset || '';
        const reservesAccrued = BigInt(token?.reservesAccrued) || 0n;
        const totalScaledDebt = BigInt(token?.totalScaledDebt) || 0n;
        const cash = BigInt(snapshot.data.tokens[token?.borrowableAsset || '']?.liquidityPoolBalance) || 0n;
        const debt = (totalScaledDebt * borrowIndex) / BigInt(1e27);
        const badDebt = token?.badDebt || 0n;
        let underlying = cash + debt + badDebt;
        if (reservesAccrued < underlying) {
            underlying -= reservesAccrued;
        } else {
            underlying = cash;
        }
        if (underlying == 0) {
          tokenPrice = 1e18;
        } else {
          tokenPrice = Number((underlying * BigInt(1e18)) / BigInt(totalSupply));
        }
      }
    }
    const tokenValue = (tokenPrice / 1000000000) * (tokenBalance / 1000000000);
    netBalance += tokenValue;
  }
  netBalance -= netLoan + (snapshot.data.userLoan?.scaledDebt || 0);
  return { timestamp: snapshot.timestamp, data: {netBalance: netBalance / 1e18 }};
}

export const getBalanceHistory = async (
  accessToken: string,
  userAddress: string,
  historyParams: HistoryParams,
): Promise<NetBalanceSnapshot[]> => {

  const storageFilters = [
    'data->>lpToken.neq.""',
    'data->>_symbol.like.*-LP',
    'data->>_symbol.in.(MUSDST,SUSDST)',
    'data->>sToken.gt.0',
    'and(data->>mToken.gt.0,data->>borrowIndex.gt.0)'
  ]

  const mappingFilters = [
    `path.like.*${userAddress}*`,
    'path.like.prices[*',
    'path.like.collateralConfigs[*',
    'path.like.collateralGlobalStates[*',
    'and(address.eq.937efa7e3a77e20bbdbd7c0d32b6514f368c1010,path.eq._balances[0000000000000000000000000000000000001004])'
  ]

  const mappingCollectionNames = [
    '_balances',
    'collateralConfigs',
    'collateralGlobalStates',
    'prices',
    'userCollaterals',
    'userLoan',
    'vaults'
  ]

  const balanceHistory = await getHistory(
    accessToken,
    historyParams,
    storageFilters,
    mappingFilters,
    mappingCollectionNames,
    { tokens: {}, userLoan: {} },
    updatePortfolioInfoStorage,
    updatePortfolioInfoMapping,
    processBalanceSnapshot
  );
  return balanceHistory.map(({timestamp, data}) => ({timestamp, netBalance: data.netBalance}));
};