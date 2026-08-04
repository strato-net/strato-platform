import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getRebaseFactors } from "./oracle.service";
import { getSaveUsdstInfo, getSaveUsdstUserInfo } from "./saveUsdst.service";
import { getUserStakedStratoBalance } from "./staking.service";
import { getLoan } from "./lending.service";
import { getVaults } from "./cdp.service";
import { listVaultDefs, getYieldVaultInfo, getYieldVaultUserInfo } from "./yieldVault.service";
import { Token, EarningAsset, BalanceSnapshot } from "@strato/shared-types";
import { buildTokenSelectFields } from "../../config/tokensConstants";
import { getHistory, HistoryParams, HistorySnapshot, MappingHistoryElement, StorageHistoryElement } from "../helpers/history.helper";
import { getHistoryDirect, fetchActiveRequestIds, fetchVaultHistoryConfig, fetchUserV3PoolMeta, PoolV3Meta } from "../helpers/historyDb.helper";
import { calculateLPTokenPrice } from "../helpers/swapping.helper";
import { getPositions as getV3Positions, getPoolTokenPairs as getV3PoolTokenPairs } from "./poolV3.service";
import * as v3Math from "../helpers/poolV3Math.helper";
import { safeBigInt } from "../helpers/vaultPerformance.helper";

const { Token, CollateralVault, CDPEngine, MercataBridge, mercataBridge, DECIMALS, priceOracle } = constants;

// Queries MercataBridge config for the unanimous externalSymbol for each given strato token address.
// Returns a map of stratoToken -> externalSymbol.
// Used to display the equivalent quantity of an external rebasing token in the UI.
// Omits tokens who map to multiple different externalSymbol values for different chains.
const getRebasingExternalSymbols = async (
  accessToken: string,
  stratoTokenAddresses: string[]
): Promise<Map<string, string>> => {
  if (!stratoTokenAddresses.length || !mercataBridge) return new Map();
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
    // size > 1 → conflicting symbols across routes → omit
  }
  return result;
};

const buildSaveUsdstEarningAsset = (
  info: Awaited<ReturnType<typeof getSaveUsdstInfo>>,
  userInfo?: Awaited<ReturnType<typeof getSaveUsdstUserInfo>>
): EarningAsset | null => {
  if (!info.deployed || !info.vaultAddress) return null;

  const balance = userInfo?.userShares || "0";
  const totalBalance = balance;
  const price = info.projectedExchangeRate || info.exchangeRate || "0";
  const redeemableValueUsd = userInfo?.projectedRedeemableAssets || userInfo?.redeemableAssets || "0";
  const value = (Number(BigInt(redeemableValueUsd || "0")) / 1e18).toFixed(2);

  return {
    address: info.vaultAddress,
    _name: "Save USDST",
    _symbol: info.shareSymbol || "saveUSDST",
    _owner: "",
    _totalSupply: info.totalShares || "0",
    customDecimals: 18,
    description: "Native USDST savings token",
    status: "2",
    _paused: info.paused,
    balance,
    images: [],
    attributes: [],
    price,
    collateralBalance: "0",
    totalBalance,
    value,
    apy: info.apy || "0",
  };
};

const buildYieldVaultEarningAsset = (
  info: Awaited<ReturnType<typeof getYieldVaultInfo>>,
  userInfo?: Awaited<ReturnType<typeof getYieldVaultUserInfo>> | null
): EarningAsset | null => {
  if (!info.deployed || !info.vaultAddress) return null;

  const balance = userInfo?.userShares ?? "0";
  const totalBalance = balance;
  let value = "0.00";
  if (userInfo) {
    const positionUsd = BigInt(userInfo.positionUsd || "0");
    const assetPrice = BigInt(info.assetPriceWad || "0");
    const unit = BigInt(10) ** BigInt(info.decimals || 18);
    const claimableUsd = assetPrice > 0n ? (BigInt(userInfo.claimableAssets || "0") * assetPrice) / unit : 0n;
    const queuedUsd = userInfo.pendingWithdrawal
      ? (assetPrice > 0n ? (BigInt(userInfo.pendingWithdrawal.estimatedAssets || "0") * assetPrice) / unit : 0n)
      : 0n;
    value = (Number(positionUsd + claimableUsd + queuedUsd) / 1e18).toFixed(2);
  }

  return {
    address: info.vaultAddress,
    _name: info.name,
    _symbol: info.shareSymbol,
    _owner: "",
    _totalSupply: info.totalShares || "0",
    customDecimals: info.decimals,
    description: "Carry vault",
    status: "2",
    _paused: info.paused,
    balance,
    images: [],
    attributes: [],
    price: ((BigInt(info.exchangeRate || "0") * BigInt(info.assetPriceWad || "0")) / BigInt(1e18)).toString(),
    collateralBalance: "0",
    totalBalance,
    value,
    apy: info.apy || "0",
  };
};

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

// `includeHeldNonActive` is for the net balance calculation only: it widens the query to
// every status and then keeps non-ACTIVE tokens only where the user actually holds them.
// The default stays ACTIVE-only so the My Tokens list is unaffected.
export const getEarningAssets = async (
  accessToken: string,
  userAddress: string,
  includeHeldNonActive = false
): Promise<EarningAsset[]> => {
  const [tokens, collaterals, cdps, rawPrices, saveUsdstInfo, saveUsdstUserInfo, rebaseFactorMap, stakedStrato] = await Promise.all([
    cirrus.get(accessToken, "/" + Token, {
      params: {
        "balances.key": `eq.${userAddress}`,
        select: buildTokenSelectFields({
          images: true,
          attributes: true,
          balance: true,
        }).join(","),
        ...(includeHeldNonActive ? {} : { status: "eq.2" }),
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
    getSaveUsdstInfo(accessToken).catch(() => null),
    getSaveUsdstUserInfo(accessToken, userAddress).catch(() => null),
    getRebaseFactors(accessToken),
    getUserStakedStratoBalance(accessToken, userAddress).catch(() => ({ tokenAddress: "", amount: 0n })),
  ]);

  const collateralMap = new Map<string, bigint>();
  [...(collaterals.data || []), ...(cdps.data || [])].forEach((item: any) =>
    collateralMap.set(
      item.asset,
      (collateralMap.get(item.asset) || 0n) + BigInt(item.amount || "0")
    )
  );

  const rebasingAddresses = (tokens.data || [])
    .map((t: any) => t.address as string)
    .filter((addr: string) => rebaseFactorMap.has(addr));

  const rebasingExternalSymbolMap = await getRebasingExternalSymbols(accessToken, rebasingAddresses)
    .catch(() => new Map<string, string>());

  const earningAssets = (tokens.data || []).map((t: any) => {
    const balance = t.balances?.[0]?.balance || "0";
    const price = rawPrices.get(t.address) || "0";
    const collateralBalance = (collateralMap.get(t.address) || 0n).toString();
    const stakedBalance =
      stakedStrato.amount > 0n && (t.address || "").toLowerCase() === stakedStrato.tokenAddress
        ? stakedStrato.amount.toString()
        : "0";
    const totalBalance = BigInt(balance) + BigInt(collateralBalance) + BigInt(stakedBalance);
    const value =
      price && price !== "0"
        ? (
            Number((totalBalance * BigInt(price)) / DECIMALS) / Number(DECIMALS)
          ).toFixed(2)
        : "0.00";

    const rebaseFactor = rebaseFactorMap.get(t.address);
    const rebasingExternalSymbol = rebaseFactor ? rebasingExternalSymbolMap.get(t.address) : undefined;

    return {
      ...t,
      balance,
      price,
      collateralBalance,
      stakedBalance,
      totalBalance: totalBalance.toString(),
      value,
      ...(rebaseFactor ? { rebaseFactor } : {}),
      ...(rebasingExternalSymbol ? { rebasingExternalSymbol } : {}),
    };
  }).filter(
    (asset: EarningAsset) =>
      !includeHeldNonActive ||
      String(asset.status) === "2" ||
      BigInt(asset.totalBalance || "0") > 0n
  );

  const saveUsdstAsset = saveUsdstInfo?.deployed
    ? buildSaveUsdstEarningAsset(saveUsdstInfo, saveUsdstUserInfo ?? undefined)
    : null;

  if (saveUsdstAsset) {
    const existingIdx = earningAssets.findIndex(
      (asset: EarningAsset) => asset.address.toLowerCase() === saveUsdstAsset.address.toLowerCase()
    );
    if (existingIdx >= 0) {
      earningAssets[existingIdx] = saveUsdstAsset;
    } else {
      earningAssets.push(saveUsdstAsset);
    }
  }

  const yieldVaultPairs = await Promise.all(
    listVaultDefs().map(async (def) => ({
      info: await getYieldVaultInfo(accessToken, def.key).catch(() => null),
      userInfo: await getYieldVaultUserInfo(accessToken, def.key, userAddress).catch(() => null),
    }))
  );
  for (const { info, userInfo } of yieldVaultPairs) {
    if (!info?.deployed) continue;
    const yvAsset = buildYieldVaultEarningAsset(info, userInfo ?? undefined);
    if (!yvAsset) continue;
    const existingIdx = earningAssets.findIndex(
      (asset: EarningAsset) => asset.address.toLowerCase() === yvAsset.address.toLowerCase()
    );
    if (existingIdx >= 0) {
      earningAssets[existingIdx] = yvAsset;
    } else {
      earningAssets.push(yvAsset);
    }
  }

  return earningAssets;
};

export const getPublicEarningAssets = async (
  accessToken: string
): Promise<EarningAsset[]> => {
  // Build token query params - no user balance filter for public data
  const tokenParams: Record<string, string> = {
        select: buildTokenSelectFields({
          images: true,
          attributes: true,
          balance: false, // No balance for guests
        }).join(","),
        status: "eq.2",
  };

  // Fetch only tokens and prices (skip user-specific collateral data)
  const [tokens, rawPrices, saveUsdstInfo] = await Promise.all([
    cirrus.get(accessToken, "/" + Token, { params: tokenParams }),
    getCompletePriceMap(accessToken),
    getSaveUsdstInfo(accessToken).catch(() => null),
  ]);

  const earningAssets = (tokens.data || []).map((t: any) => {
    const balance = "0";
    const price = rawPrices.get(t.address) || "0";
    const collateralBalance = "0";
    const totalBalance = 0n;
    const value = "0.00";

    return {
      ...t,
      balance,
      price,
      collateralBalance,
      totalBalance: totalBalance.toString(),
      value,
    };
  });

  const saveUsdstAsset = saveUsdstInfo ? buildSaveUsdstEarningAsset(saveUsdstInfo) : null;
  if (
    saveUsdstAsset &&
    !earningAssets.some((asset: EarningAsset) => asset.address.toLowerCase() === saveUsdstAsset.address.toLowerCase())
  ) {
    earningAssets.push(saveUsdstAsset);
  }

  const yieldVaultInfos = await Promise.all(
    listVaultDefs().map((def) => getYieldVaultInfo(accessToken, def.key).catch(() => null))
  );
  for (const info of yieldVaultInfos) {
    if (!info?.deployed) continue;
    const yvAsset = buildYieldVaultEarningAsset(info, null);
    if (
      yvAsset &&
      !earningAssets.some((asset: EarningAsset) => asset.address.toLowerCase() === yvAsset.address.toLowerCase())
    ) {
      earningAssets.push(yvAsset);
    }
  }

  return earningAssets;
};

function updatePortfolioInfoStorage(portfolioInfo: any, newInfo: StorageHistoryElement): any {
  // V3 pool state: only the price is needed — position amounts at time t derive from it
  if (portfolioInfo.v3PoolMeta?.[newInfo.address] && newInfo.data.sqrtPriceX96 != null) {
    return { ...portfolioInfo,
      v3Pools: { ...portfolioInfo.v3Pools,
        [newInfo.address]: String(newInfo.data.sqrtPriceX96)
      }
    };
  }
  if (newInfo.data._symbol) {
    const totalSupply = newInfo.data._totalSupply || '0';
    const symbol = newInfo.data._symbol || '';
    const isLpToken = symbol.endsWith('-LP');
    return { ...portfolioInfo,
      tokens: { ...portfolioInfo.tokens,
        [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
          supply: totalSupply,
          ...(isLpToken ? { isLpToken: true } : {}),
          ...(newInfo.data._managedAssets ? { managedAssets: BigInt(newInfo.data._managedAssets) } : {}),
          ...(newInfo.data.deployedAssets != null ? {
            deployedAssets: BigInt(newInfo.data.deployedAssets || 0),
            totalClaimableAssets: BigInt(newInfo.data.totalClaimableAssets || 0),
            underlyingAsset: newInfo.data._asset || '',
          } : {})
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
      // Kept at the top level too: userLoan is stored per-user, not per-mToken, so
      // processBalanceSnapshot needs the pool's index to unscale the user's debt.
      lendingBorrowIndex: BigInt(newInfo.data.borrowIndex || '') || 0n,
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
      // Keep wei as string for vault/LP infrastructure balances — parseFloat loses precision
      // above Number.MAX_SAFE_INTEGER and zeroes out arbV equity.
      const rawValue = newInfo.value;
      const newValue = parseFloat(rawValue) || rawValue || 0;
      const pathLower = (newInfo.path || '').toLowerCase();
      if (pathLower === '_balances[0000000000000000000000000000000000001004]') {
        return { ...portfolioInfo, 
          tokens: { ...portfolioInfo.tokens,
            [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
              liquidityPoolBalance: String(rawValue ?? '0')
            }
          }
        };
      }
      const botExecutor = portfolioInfo.vaultConfig?.botExecutor;
      if (botExecutor && pathLower === `_balances[${botExecutor}]`.toLowerCase()) {
        return { ...portfolioInfo, 
          tokens: { ...portfolioInfo.tokens,
            [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
              vaultAssetBalance: String(rawValue ?? '0')
            }
          }
        };
      }
      if (portfolioInfo.carryVaultAddrs) {
        for (const cvAddr of portfolioInfo.carryVaultAddrs) {
          if (pathLower === `_balances[${cvAddr}]`.toLowerCase()) {
            if (portfolioInfo.tokens[cvAddr]?.underlyingAsset === newInfo.address) {
              return { ...portfolioInfo, 
                tokens: { ...portfolioInfo.tokens,
                  [cvAddr]: { ...portfolioInfo.tokens[cvAddr],
                    idleAssets: newValue
                  }
                }
              };
            }
            return portfolioInfo;
          }
        }
      }
      // `balance` accumulates wallet and collateral, which live in different collections.
      // Only one row per (address, path) is valid per snapshot, so adding cannot
      // double-count, and it keeps the result independent of row order.
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
    case 'positions': {
      // PoolV3 positions[owner][tickLower][tickUpper] → {liquidity, tokensOwed0/1, ...}.
      // Only rows on known V3 pools count — other contracts may have a 'positions' collection too.
      if (!portfolioInfo.v3PoolMeta?.[newInfo.address]) return portfolioInfo;
      const tickLower = parseInt(newInfo.key['key2'] || '', 10);
      const tickUpper = parseInt(newInfo.key['key3'] || '', 10);
      if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) return portfolioInfo;
      const v = newInfo.value || {};
      return { ...portfolioInfo,
        v3Positions: { ...portfolioInfo.v3Positions,
          [`${newInfo.address}:${tickLower}:${tickUpper}`]: {
            poolAddress: newInfo.address,
            tickLower,
            tickUpper,
            liquidity: String(v.liquidity ?? '0'),
            tokensOwed0: String(v.tokensOwed0 ?? '0'),
            tokensOwed1: String(v.tokensOwed1 ?? '0'),
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
    case 'claimableAssets': {
      if (portfolioInfo.carryVaultAddrs?.has(newInfo.address)) {
        const newValue = parseFloat(newInfo.value) || 0;
        return { ...portfolioInfo,
          tokens: { ...portfolioInfo.tokens,
            [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
              userClaimableAssets: newValue
            }
          }
        };
      }
      return portfolioInfo;
    }
    case 'requests': {
      if (portfolioInfo.carryVaultAddrs?.has(newInfo.address)) {
        const shares = parseFloat(newInfo.value?.shares) || 0;
        return { ...portfolioInfo,
          tokens: { ...portfolioInfo.tokens,
            [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
              userQueuedShares: shares
            }
          }
        };
      }
      return portfolioInfo;
    }
    case 'delegatedStake': {
      // StratoStaking: user's delegated stake to an operator
      // key = userAddress, key2 = operatorAddress, value = stake amount
      const stakeAmount = BigInt(newInfo.value || '0');
      const currentStaked = portfolioInfo.stakedStrato || 0n;
      return { ...portfolioInfo, stakedStrato: currentStaked + stakeAmount };
    }
    case 'unbondingQueue': {
      // StratoStaking: user's unbonding request (unclaimed)
      // value = { amount, releaseTime, claimed }
      const unbondingValue = newInfo.value || {};
      const isClaimed = unbondingValue.claimed === true || unbondingValue.claimed === 'true';
      if (!isClaimed) {
        const unbondingAmount = BigInt(unbondingValue.amount || '0');
        const currentStaked = portfolioInfo.stakedStrato || 0n;
        return { ...portfolioInfo, stakedStrato: currentStaked + unbondingAmount };
      }
      return portfolioInfo;
    }
    case 'operators': {
      // StratoStaking: operator self-bond (if user is an operator)
      // key = operatorAddress, value = { selfBond, ... }
      const operatorValue = newInfo.value || {};
      const selfBond = BigInt(operatorValue.selfBond || '0');
      if (selfBond > 0n) {
        const currentStaked = portfolioInfo.stakedStrato || 0n;
        return { ...portfolioInfo, stakedStrato: currentStaked + selfBond };
      }
      return portfolioInfo;
    }
  }
  return portfolioInfo;
}

function processBalanceSnapshot(snapshot: {timestamp: number, data: any}, index: number): {timestamp: number, data: any} {
  let netBalance: number = 0;
  let netLoan: number = 0;
  let v3Total = 0;
  let v3Count = 0;
  let arbVValue = 0;

  const shareTokenNorm = (snapshot.data.vaultConfig?.shareToken || '')
    .toLowerCase()
    .replace(/^0x/, '');

  for (const tokenAddr in snapshot.data.tokens) {
    const token = snapshot.data.tokens[tokenAddr] || {};
    let tokenPrice = token?.price || 0;
    const tokenBalance = token?.balance || 0;

    if (token?.scaledDebt) {
      const rateAccumulator = Number(safeBigInt(token?.rateAccumulator) / 1000000000000000000n) / 1000000000;
      const loanAmt = (token?.scaledDebt || 0) * rateAccumulator;
      netLoan += loanAmt;
    }
    if (snapshot.data.carryVaultAddrs?.has(tokenAddr)) {
      if (token?.userClaimableAssets) {
        const ulAsset = token?.underlyingAsset || '';
        const ulPrice = snapshot.data.tokens[ulAsset]?.price || 0;
        const claimableValue = (token.userClaimableAssets / 1000000000) * (ulPrice / 1000000000);
        netBalance += claimableValue;
      }
      if (token?.userQueuedShares) {
        const supply = token?.supply || '0';
        if (supply !== '0') {
          const deployed = safeBigInt(token?.deployedAssets);
          const claimable = safeBigInt(token?.totalClaimableAssets);
          const idle = safeBigInt(token?.idleAssets);
          const cvTotal = idle + deployed;
          const cvActive = cvTotal > claimable ? cvTotal - claimable : 0n;
          if (cvActive > 0n) {
            const ulAsset = token?.underlyingAsset || '';
            const ulPrice = snapshot.data.tokens[ulAsset]?.price || 0;
            const queuedAssets = Number((safeBigInt(Math.round(token.userQueuedShares).toString()) * cvActive) / safeBigInt(supply));
            const queuedValue = (queuedAssets / 1000000000) * (ulPrice / 1000000000);
            netBalance += queuedValue;
          }
        }
      }
    }

    // Handle LP tokens specially - never use oracle price for them
    const isLpToken = token?.isLpToken || token?.pool;
    const isVaultShare =
      !!shareTokenNorm &&
      tokenAddr.toLowerCase().replace(/^0x/, '') === shareTokenNorm;

    if (tokenBalance === 0) continue;

    if (isLpToken) {
      const pool = token?.pool;
      const totalSupply = token?.supply || '0';
      if (pool && totalSupply !== '0') {
        tokenPrice = calculateLPTokenPrice(
          pool.tokenABalance,
          pool.tokenBBalance,
          snapshot.data.tokens[pool.tokenA]?.price || '0',
          snapshot.data.tokens[pool.tokenB]?.price || '0',
          totalSupply
        );
      } else {
        // LP token without pool data - skip entirely (don't use oracle price)
        continue;
      }
    } else if (isVaultShare) {
      // Same NAV formula as box getVaultShareTokenPrice — always derive, never oracle.
      const totalSupply = token?.supply || '0';
      if (totalSupply === '0') {
        console.log(`[NB-ARBV] idx=${index} skip=no-supply addr=${tokenAddr}`);
        continue;
      }
      const supportedAssets: string[] = snapshot.data.vaultConfig?.supportedAssets || [];
      const tokByLower = new Map(
        Object.entries(snapshot.data.tokens).map(([k, v]) => [k.toLowerCase(), v])
      );
      let totalEquity = 0n;
      let assetsWithBal = 0;
      for (const assetAddr of supportedAssets) {
        const assetTok =
          snapshot.data.tokens[assetAddr] || tokByLower.get(assetAddr.toLowerCase());
        const bal = safeBigInt(assetTok?.vaultAssetBalance);
        const assetPrice = safeBigInt(assetTok?.price);
        if (bal > 0n) assetsWithBal++;
        if (assetPrice > 0n) {
          totalEquity += (bal * assetPrice) / BigInt(1e18);
        }
      }
      if (totalEquity > 0n) {
        tokenPrice = Number((totalEquity * BigInt(1e18)) / safeBigInt(totalSupply));
      } else {
        console.log(
          `[NB-ARBV] idx=${index} skip=zero-equity addr=${tokenAddr} ` +
          `supported=${supportedAssets.length} withBal=${assetsWithBal} supply=${totalSupply}`
        );
      }
    } else if (tokenPrice === 0) {
      const totalSupply = token?.supply || '0';
      if (totalSupply === '0') continue;
      const managedAssets = token?.managedAssets;
      if (managedAssets) { // sUSDST
        tokenPrice = Number((safeBigInt(managedAssets) * BigInt(1e18)) / safeBigInt(totalSupply));
      } else if (snapshot.data.carryVaultAddrs?.has(tokenAddr)) {
        const deployed = safeBigInt(token?.deployedAssets);
        const claimable = safeBigInt(token?.totalClaimableAssets);
        const idle = safeBigInt(token?.idleAssets);
        const cvTotalAssets = idle + deployed;
        const cvActiveAssets = cvTotalAssets > claimable ? cvTotalAssets - claimable : 0n;
        const underlyingAsset = token?.underlyingAsset || '';
        const assetPrice = safeBigInt(snapshot.data.tokens[underlyingAsset]?.price);
        if (cvActiveAssets > 0n && assetPrice > 0n) {
          tokenPrice = Number((cvActiveAssets * assetPrice) / safeBigInt(totalSupply));
        }
      } else { // mUSDST
        const borrowIndex = safeBigInt(token?.borrowIndex);
        const reservesAccrued = safeBigInt(token?.reservesAccrued);
        const totalScaledDebt = safeBigInt(token?.totalScaledDebt);
        const cash = safeBigInt(snapshot.data.tokens[token?.borrowableAsset || '']?.liquidityPoolBalance);
        const debt = (totalScaledDebt * borrowIndex) / BigInt(1e27);
        const badDebt = safeBigInt(token?.badDebt);
        let underlying = cash + debt + badDebt;
        if (reservesAccrued < underlying) {
            underlying -= reservesAccrued;
        } else {
            underlying = cash;
        }
        if (underlying == 0n) {
          tokenPrice = 1e18;
        } else {
          tokenPrice = Number((underlying * BigInt(1e18)) / safeBigInt(totalSupply));
        }
      }
    }
    const tokenValue = (tokenPrice / 1000000000) * (tokenBalance / 1000000000);
    netBalance += tokenValue;
    if (isVaultShare) {
      arbVValue = tokenValue / 1e18;
      console.log(
        `[NB-ARBV] idx=${index} addr=${tokenAddr} bal=${tokenBalance} price=${tokenPrice} ` +
        `value=$${arbVValue.toFixed(2)}`
      );
    }
  }

  // V3 concentrated-liquidity positions: reconstruct the position's token amounts from
  // the pool's price at this snapshot, then value them at the token prices at this
  // snapshot (same historical-price replay the fungible tokens use).
  const v3Meta = snapshot.data.v3PoolMeta || {};
  for (const pos of Object.values(snapshot.data.v3Positions || {}) as any[]) {
    const meta = v3Meta[pos.poolAddress];
    if (!meta) continue;
    let a0: bigint;
    let a1: bigint;
    try {
      a0 = BigInt(pos.tokensOwed0 || '0');
      a1 = BigInt(pos.tokensOwed1 || '0');
      const liquidity = BigInt(pos.liquidity || '0');
      const sqrtPriceX96 = BigInt(snapshot.data.v3Pools?.[pos.poolAddress] || '0');
      if (liquidity > 0n && sqrtPriceX96 > 0n) {
        const { amount0, amount1 } = v3Math.getAmountsForLiquidity(
          sqrtPriceX96,
          v3Math.getTickAtSqrtRatio(sqrtPriceX96),
          pos.tickLower,
          pos.tickUpper,
          liquidity,
          false,
        );
        a0 += amount0;
        a1 += amount1;
      }
    } catch { continue; }
    if (a0 === 0n && a1 === 0n) continue;
    const price0 = parseFloat(snapshot.data.tokens[meta.token0]?.price) || 0;
    const price1 = parseFloat(snapshot.data.tokens[meta.token1]?.price) || 0;
    const posValue = (price0 / 1e9) * (Number(a0) / 1e9) + (price1 / 1e9) * (Number(a1) / 1e9);
    netBalance += posValue;
    v3Total += posValue / 1e18;
    v3Count++;
  }

  // Add staked STRATO value to net balance
  const stakedStrato = snapshot.data.stakedStrato || 0n;
  if (stakedStrato > 0n) {
    const stratoTokenAddr = snapshot.data.stratoTokenAddress || '';
    const stratoPrice = snapshot.data.tokens[stratoTokenAddr]?.price || 0;
    if (stratoPrice > 0) {
      const stakedValue = (Number(stakedStrato) / 1e9) * (stratoPrice / 1e9);
      netBalance += stakedValue;
    }
  }

  // userLoan holds scaled debt; actual USDST owed is scaledDebt * borrowIndex / RAY,
  // the same conversion debtFromScaled applies for the Net Balance box.
  const scaledDebt = parseFloat(snapshot.data.userLoan?.scaledDebt || '0');
  const borrowIndex = safeBigInt(snapshot.data.lendingBorrowIndex);
  const lendingDebt = borrowIndex > 0n ? scaledDebt * (Number(borrowIndex) / 1e27) : scaledDebt;

  netBalance -= netLoan + lendingDebt;

  if (index === 0 || v3Count > 0 || arbVValue > 0) {
    console.log(
      `[NB-GRAPH] idx=${index} v3Count=${v3Count} v3=$${v3Total.toFixed(2)} ` +
      `arbV=$${arbVValue.toFixed(2)} net=$${(netBalance / 1e18).toFixed(2)}`
    );
  }

  return { timestamp: snapshot.timestamp, data: {netBalance: netBalance / 1e18 }};
}

export const getBalanceHistory = async (
  accessToken: string,
  userAddress: string,
  tokenAddress: string,
  historyParams: HistoryParams,
): Promise<BalanceSnapshot[]> => {
  const reducer = (data: any, h: MappingHistoryElement): HistorySnapshot => {
    switch (h.collection_name) {
      case '_balances': {
        const currentBalance = data.balance || 0;
        const newValue = parseFloat(h.value) || h.value || 0;
        return { ...data,
          balance: currentBalance + (newValue / 1e18)
        };
      }
      case 'userCollaterals': {
        const currentBalance = data.balance || 0;
        const newValue = parseFloat(h.value) || h.value || 0;
        return { ...data,
          balance: currentBalance + (newValue / 1e18)
        };
      }
    }
    return data;
  }

  const balanceHistory = await getHistory(
    accessToken,
    historyParams,
    [],
    [`and(path.like.*${userAddress}*,address.eq.${tokenAddress})`],
    ['_balances', 'userCollaterals'],
    { balance: 0 },
    ((s,_) => s),
    reducer,
    ((s,_) => s)
  );
  return balanceHistory.map(({timestamp, data}) => ({timestamp, balance: data.balance}));
};

export const getNetBalanceHistory = async (
  accessToken: string,
  userAddress: string,
  historyParams: HistoryParams,
): Promise<BalanceSnapshot[]> => {

  // Pre-fetch vault config, carry vault active request IDs, and the user's V3 pools
  // in parallel (3 queries, not N+1)
  const carryVaultAddrs = listVaultDefs().filter(v => v.address).map(v => v.address);
  const windowStart = new Date(historyParams.endTimestamp - historyParams.interval * historyParams.numTicks).toISOString();
  const windowEnd = new Date(historyParams.endTimestamp).toISOString();

  const [vaultConfig, activeReqMap, v3PoolMeta] = await Promise.all([
    fetchVaultHistoryConfig(config.vault),
    fetchActiveRequestIds(carryVaultAddrs, userAddress).catch(() => new Map<string, string>()),
    fetchUserV3PoolMeta(windowStart, windowEnd, userAddress),
  ]);

  const requestFilters: { address: string; path: string }[] = [];
  for (const [addr, reqId] of activeReqMap) {
    requestFilters.push({ address: addr, path: `requests[${reqId}]` });
  }

  const poolV3Addrs = [...v3PoolMeta.keys()];
  const v3PoolMetaObj: Record<string, PoolV3Meta> = Object.fromEntries(v3PoolMeta);
  const v3PairTokens = [...new Set([...v3PoolMeta.values()].flatMap(m => [m.token0, m.token1]))];

  // Staking addresses for portfolio history
  const stratoStakingAddress = config.stratoStaking || '';
  const stratoTokenAddress = config.stratoToken || '';

  const carryVaultAddrSet = new Set(carryVaultAddrs);
  const initialData = {
    tokens: {},
    userLoan: {},
    vaultConfig: vaultConfig || undefined,
    carryVaultAddrs: carryVaultAddrSet,
    v3PoolMeta: v3PoolMetaObj,
    v3Pools: {},
    v3Positions: {},
    stratoTokenAddress,
    stakedStrato: 0n, // Total staked STRATO (delegated + unbonding)
  };

  const balanceHistory = await getHistoryDirect(
    historyParams,
    {
      vaultShareToken: vaultConfig?.shareToken,
      carryVaultAddrs,
      poolV3Addrs,
    },
    {
      userAddress,
      botExecutor: vaultConfig?.botExecutor,
      carryVaultAddrs,
      requestFilters,
      priceOracle,
      includeV3Positions: poolV3Addrs.length > 0,
      extraRelevantTokens: v3PairTokens,
      stratoStakingAddress,
      stratoTokenAddress,
    },
    vaultConfig,
    initialData,
    updatePortfolioInfoStorage,
    updatePortfolioInfoMapping,
    processBalanceSnapshot,
  );

  // Return historical points only - all calculated consistently from historical data
  return balanceHistory.map(({timestamp, data}) => ({timestamp, balance: data.netBalance}));
};

export const getBorrowingHistory = async (
  accessToken: string,
  userAddress: string,
  historyParams: HistoryParams,
): Promise<BalanceSnapshot[]> => {
  const mappingFilters = [
    `path.like.*${userAddress}*`,
    'path.like.collateralConfigs[*',
    'path.like.collateralGlobalStates[*',
  ]

  const mappingCollectionNames = [
    'collateralConfigs',
    'collateralGlobalStates',
    'userLoan',
    'vaults'
  ]

  const reducer = (data: any, h: MappingHistoryElement): HistorySnapshot => {
    switch (h.collection_name) {
      case 'collateralConfigs': {
        const stabilityFeeRate = BigInt(h.value.stabilityFeeRate || '1000000000627937192293877252');
        return { ...data, 
          tokens: { ...data.tokens,
            [h.key.key || '']: { ...data.tokens[h.key.key || ''],
              stabilityFeeRate: stabilityFeeRate
            }
          }
        };
      }
      case 'collateralGlobalStates': {
        const rateAccumulator = BigInt(h.value.rateAccumulator || BigInt(1e27));
        const lastAccrual = parseFloat(h.value.lastAccrual) || 0;
        return { ...data, 
          tokens: { ...data.tokens,
            [h.key.key || '']: { ...data.tokens[h.key.key || ''],
              rateAccumulator: rateAccumulator,
              lastAccrual: lastAccrual
            }
          }
        };
      }
      case 'vaults': {
        const scaledDebt = parseFloat(h.value.scaledDebt) || 0;
        return { ...data, 
          tokens: { ...data.tokens,
            [h.key.key2 || '']: { ...data.tokens[h.key.key2],
              scaledDebt: BigInt(scaledDebt)
            }
          }
        };
      }
      case 'userLoan': {
        const scaledDebt = parseFloat(h.value.scaledDebt) || 0;
        const lastUpdated = parseInt(h.value.lastUpdated) || 0;
        return { ...data, 
          userLoan: data.userLoan + scaledDebt,
          lastUpdated: lastUpdated
        };
      }
    }
    return data;
  }

  const balanceHistory = await getHistory(
    accessToken,
    historyParams,
    [],
    mappingFilters,
    mappingCollectionNames,
    { tokens: {}, userLoan: 0 },
    ((s,_) => s),
    reducer,
    ((s,_) => {
      let netLoan = 0;
      for (const tokenAddr in s.data.tokens) {
        const token = s.data.tokens[tokenAddr];
        const stabilityFeeRate = token.stabilityFeeRate || BigInt('1000000000627937192293877252');
        const lastAccrual = token.lastAccrual || 0;
        const rateAccumulator = token.rateAccumulator || BigInt(1e27);
        const scaledDebt = token.scaledDebt || 0;
        const minusRAY = BigInt(stabilityFeeRate) - BigInt(1e27);
        const interestRate = Math.round(200 * Number(minusRAY / 1000n) / 627937192293877.252) / 10000;
        const dt = s.timestamp - (1000 * lastAccrual);
        const ert = Math.exp(interestRate * dt / (1000*60*60*24*365));
        const rateAccErt = Number(rateAccumulator) * ert / 1e27;
        netLoan += Number(scaledDebt) * rateAccErt / 1e18;
      }
      const userLoan = s.data.userLoan || 0;
      const lastUpdated = s.data.lastUpdated || 0;
      const dt = s.timestamp - (1000*lastUpdated);
      const ert = Math.exp(0.05 * dt / (1000*60*60*24*365));
      netLoan += (userLoan * ert)/1e18;
      return { ...s, data: { balance: netLoan }};
    })
  );
  return balanceHistory.map(({timestamp, data}) => ({timestamp, balance: data.balance}));
};

export const getPoolPriceHistory = async (
  accessToken: string,
  userAddress: string,
  poolAddress: string,
  historyParams: HistoryParams,
): Promise<BalanceSnapshot[]> => {
  const storageFilters = [
    `address.eq.${poolAddress}`
  ]

  const reducer = (data: any, h: StorageHistoryElement): any => {
    const tokenABalance = parseFloat(h.data.tokenABalance) || 0;
    const tokenBBalance = parseFloat(h.data.tokenBBalance) || 0;
    if (tokenABalance === 0) {
      return { balance: 0.0 };
    }

    const balanceRatio = tokenBBalance / tokenABalance; 

    if (h.data.isStable) {
        return { balance: parseFloat(h.data.aToBRatio) || balanceRatio };
    }

    return { balance: tokenBBalance / tokenABalance };
  }

  const balanceHistory = await getHistory(
    accessToken,
    historyParams,
    [`address.eq.${poolAddress}`],
    [],
    [],
    { price: 0.0 },
    reducer,
    ((s,_) => s),
    ((s,_) => s)
  );
  return balanceHistory.map(({timestamp, data}) => ({timestamp, balance: data.balance}));
};

/**
 * USD value of the user's V3 concentrated-liquidity positions at the current pool
 * price: principal at spot + realized owed + pending fees, valued at oracle prices.
 * V3 positions aren't tokens, so the balance-driven valuation never sees them.
 */
const getV3PositionsValue = async (accessToken: string, userAddress: string): Promise<number> => {
  const positions = await getV3Positions(accessToken, userAddress);
  if (positions.length === 0) {
    console.log(`[NB-V3-BOX] positions=0 value=$0.00`);
    return 0;
  }

  const poolAddresses = [...new Set(positions.map((p) => p.poolAddress))];
  const [pairs, priceMap] = await Promise.all([
    getV3PoolTokenPairs(accessToken, poolAddresses),
    getCompletePriceMap(accessToken),
  ]);

  let totalWadWad = 0n; // 1e36-scaled (wei amount × wei price)
  for (const pos of positions) {
    const pair = pairs.get(pos.poolAddress);
    if (!pair) continue;
    try {
      const price0 = BigInt(priceMap.get(pair.token0) || "0");
      const price1 = BigInt(priceMap.get(pair.token1) || "0");
      const amount0 = BigInt(pos.amount0) + BigInt(pos.tokensOwed0) + BigInt(pos.pendingFees0 || "0");
      const amount1 = BigInt(pos.amount1) + BigInt(pos.tokensOwed1) + BigInt(pos.pendingFees1 || "0");
      totalWadWad += amount0 * price0 + amount1 * price1;
    } catch { /* skip malformed rows */ }
  }
  const value = Number(totalWadWad / 10n ** 18n) / 1e18;
  console.log(`[NB-V3-BOX] positions=${positions.length} pools=${poolAddresses.length} value=$${value.toFixed(2)}`);
  return value;
};

export const getNetBalance = async (
  accessToken: string,
  userAddress: string
): Promise<{ netBalance: number; totalBorrowed: number; totalAssetValue: number }> => {
  const [earningAssetsResult, loanResult, vaultsResult, v3Result] = await Promise.allSettled([
    // Held PENDING/LEGACY tokens count towards the balance, matching the history graph.
    getEarningAssets(accessToken, userAddress, true),
    getLoan(accessToken, userAddress),
    getVaults(accessToken, userAddress),
    getV3PositionsValue(accessToken, userAddress),
  ]);

  let totalAssetValue = 0;
  if (earningAssetsResult.status === "fulfilled") {
    for (const asset of earningAssetsResult.value) {
      const value = parseFloat(asset.value || "0");
      totalAssetValue += value;
      if ((asset._symbol || "").toLowerCase() === "arbv") {
        console.log(
          `[NB-ARBV-BOX] addr=${asset.address} bal=${asset.totalBalance} price=${asset.price} value=$${value.toFixed(2)}`
        );
      }
    }
  }
  if (v3Result.status === "fulfilled") {
    totalAssetValue += v3Result.value;
  }

  let lendingDebt = 0;
  if (loanResult.status === "fulfilled" && loanResult.value?.totalAmountOwed) {
    try {
      const raw = BigInt(loanResult.value.totalAmountOwed);
      if (raw > 1n) {
        lendingDebt = Number(raw) / 1e18;
      }
    } catch { /* dust or invalid */ }
  }

  let cdpDebt = 0;
  if (vaultsResult.status === "fulfilled") {
    for (const vault of vaultsResult.value) {
      try {
        const raw = BigInt(vault.debtAmount || "0");
        if (raw > 1n) {
          cdpDebt += Number(raw) / 1e18;
        }
      } catch { /* dust or invalid */ }
    }
  }

  const totalBorrowed = lendingDebt + cdpDebt;
  return {
    netBalance: totalAssetValue - totalBorrowed,
    totalBorrowed,
    totalAssetValue,
  };
};
