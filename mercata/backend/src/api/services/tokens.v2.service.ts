import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getRebaseFactors } from "./oracle.service";
import { getSaveUsdstInfo, getSaveUsdstUserInfo } from "./saveUsdst.service";
import { getUserStakedStratoBalance } from "./staking.service";
import { getLoan } from "./lending.service";
import { getVaults } from "./cdp.service";
import { listVaultDefs, getYieldVaultInfo, getYieldVaultUserInfo } from "./yieldVault.service";
import { Token, EarningAsset, BalanceSnapshot } from "@mercata/shared-types";
import { buildTokenSelectFields } from "../../config/tokensConstants";
import { getHistory, HistoryParams, HistorySnapshot, MappingHistoryElement, StorageHistoryElement } from "../helpers/history.helper";
import { getHistoryDirect, fetchActiveRequestIds, fetchVaultHistoryConfig } from "../helpers/historyDb.helper";
import { calculateLPTokenPrice } from "../helpers/swapping.helper";
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

export const getEarningAssets = async (
  accessToken: string,
  userAddress: string
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
  });

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
  if (newInfo.data._symbol) {
    const totalSupply = newInfo.data._totalSupply || '0';
    const symbol = newInfo.data._symbol || '';
    const isLpToken = symbol.endsWith('-LP');
    return { ...portfolioInfo,
      tokens: { ...portfolioInfo.tokens,
        [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
          supply: totalSupply,
          symbol: symbol,
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
      const botExecutor = portfolioInfo.vaultConfig?.botExecutor;
      if (botExecutor && newInfo.path === `_balances[${botExecutor}]`) {
        return { ...portfolioInfo, 
          tokens: { ...portfolioInfo.tokens,
            [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
              vaultAssetBalance: newValue
            }
          }
        };
      }
      if (portfolioInfo.carryVaultAddrs) {
        for (const cvAddr of portfolioInfo.carryVaultAddrs) {
          if (newInfo.path === `_balances[${cvAddr}]`) {
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
      // FIX: REPLACE instead of ADD - _balances stores absolute values, not deltas
      // Multiple rows for the same token were being added together causing 2-3x inflation
      // walletBalance mirrors balance for diagnostics only (see processBalanceSnapshot logging)
      return { ...portfolioInfo, 
        tokens: { ...portfolioInfo.tokens,
          [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
            balance: newValue,
            walletBalance: newValue
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
      // FIX: REPLACE instead of ADD - userCollaterals stores absolute values
      // collateralBalance mirrors balance for diagnostics only. NOTE: this write
      // overwrites any wallet balance for the same token — logging surfaces that.
      const token = newInfo.key['key2'] || '';
      const newValue = newInfo.value || 0;
      return { ...portfolioInfo, 
        tokens: { ...portfolioInfo.tokens,
          [token]: { ...portfolioInfo.tokens[token],
            balance: newValue,
            collateralBalance: newValue
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
  const snapshotDate = new Date(snapshot.timestamp).toISOString();
  
  let netBalance: number = 0;
  let netLoan: number = 0;
  type Bucket = 'WALLET' | 'COLLATERAL' | 'WALLET+COLLATERAL' | 'CARRY VAULT' | 'STAKED' | 'UNKNOWN SOURCE';
  const contributions: Array<{
    bucket: Bucket;
    symbol: string;
    address: string;
    balance: number;
    walletBalance: number;
    collateralBalance: number;
    priceUsd: number;
    valueUsd: number;
    isLpToken: boolean;
    hasPool: boolean;
    skipped: boolean;
    reason?: string;
    note?: string;
  }> = [];

  // Which raw source produced token.balance — both writes land on the same field,
  // so a token present in both means one silently overwrote the other.
  const classify = (token: any): { bucket: Bucket; note?: string } => {
    const w = token?.walletBalance || 0;
    const c = token?.collateralBalance || 0;
    if (w > 0 && c > 0) {
      const used = token?.balance || 0;
      return {
        bucket: 'WALLET+COLLATERAL',
        note: `OVERWRITE: wallet=${w.toExponential(2)} coll=${c.toExponential(2)} → calc used ${used.toExponential(2)}`,
      };
    }
    if (c > 0) return { bucket: 'COLLATERAL' };
    if (w > 0) return { bucket: 'WALLET' };
    return { bucket: 'UNKNOWN SOURCE' };
  };
  
  for (const tokenAddr in snapshot.data.tokens) {
    const token = snapshot.data.tokens[tokenAddr] || {};
    let tokenPrice = token?.price || 0;
    const tokenBalance = token?.balance || 0;
    const tokenSymbol = token?.symbol || tokenAddr.slice(0, 10) + '...';
    const walletBal = (token?.walletBalance || 0) / 1e18;
    const collBal = (token?.collateralBalance || 0) / 1e18;
    
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
        contributions.push({
          bucket: 'CARRY VAULT',
          symbol: `${tokenSymbol} (claimable)`,
          address: tokenAddr,
          balance: token.userClaimableAssets / 1e18,
          walletBalance: 0,
          collateralBalance: 0,
          priceUsd: ulPrice / 1e18,
          valueUsd: claimableValue / 1e18,
          isLpToken: false,
          hasPool: false,
          skipped: false,
        });
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
            contributions.push({
              bucket: 'CARRY VAULT',
              symbol: `${tokenSymbol} (queued)`,
              address: tokenAddr,
              balance: queuedAssets / 1e18,
              walletBalance: 0,
              collateralBalance: 0,
              priceUsd: ulPrice / 1e18,
              valueUsd: queuedValue / 1e18,
              isLpToken: false,
              hasPool: false,
              skipped: false,
            });
          }
        }
      }
    }
    
    // Handle LP tokens specially - never use oracle price for them
    const isLpToken = token?.isLpToken || token?.pool;
    
    if (tokenBalance === 0) {
      continue;
    }
    
    if (isLpToken) {
      const pool = token?.pool;
      const totalSupply = token?.supply || '0';
      if (pool && totalSupply !== '0') {
        // Calculate LP price from underlying token values
        tokenPrice = calculateLPTokenPrice(
          pool.tokenABalance,
          pool.tokenBBalance,
          snapshot.data.tokens[pool.tokenA]?.price || '0',
          snapshot.data.tokens[pool.tokenB]?.price || '0',
          totalSupply
        );
      } else {
        // LP token without pool data - skip entirely (don't use oracle price)
        contributions.push({
          ...classify(token),
          symbol: tokenSymbol,
          address: tokenAddr,
          balance: tokenBalance / 1e18,
          walletBalance: walletBal,
          collateralBalance: collBal,
          priceUsd: (token?.price || 0) / 1e18,
          valueUsd: 0,
          isLpToken: true,
          hasPool: false,
          skipped: true,
          reason: `NO POOL DATA (oracle=$${((token?.price || 0) / 1e18).toFixed(2)})`
        });
        continue;
      }
    } else if (tokenPrice === 0) {
      const totalSupply = token?.supply || '0';
      if (totalSupply === '0') {
        contributions.push({
          ...classify(token),
          symbol: tokenSymbol,
          address: tokenAddr,
          balance: tokenBalance / 1e18,
          walletBalance: walletBal,
          collateralBalance: collBal,
          priceUsd: 0,
          valueUsd: 0,
          isLpToken: false,
          hasPool: false,
          skipped: true,
          reason: 'NO PRICE / NO SUPPLY'
        });
        continue;
      }
      const managedAssets = token?.managedAssets;
      if (managedAssets) { // sUSDST
        tokenPrice = Number((safeBigInt(managedAssets) * BigInt(1e18)) / safeBigInt(totalSupply));
      } else if (snapshot.data.vaultConfig?.shareToken === tokenAddr) { // Vault share token
        const supportedAssets: string[] = snapshot.data.vaultConfig?.supportedAssets || [];
        let totalEquity = 0n;
        for (const assetAddr of supportedAssets) {
          const bal = safeBigInt(snapshot.data.tokens[assetAddr]?.vaultAssetBalance);
          const assetPrice = safeBigInt(snapshot.data.tokens[assetAddr]?.price);
          if (assetPrice > 0n) {
            totalEquity += (bal * assetPrice) / BigInt(1e18);
          }
        }
        if (totalEquity > 0n) {
          tokenPrice = Number((totalEquity * BigInt(1e18)) / safeBigInt(totalSupply));
        }
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
        const borrowableAsset = token?.borrowableAsset || '';
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
    const tokenValueUsd = tokenValue / 1e18;
    
    contributions.push({
      ...classify(token),
      symbol: tokenSymbol,
      address: tokenAddr,
      balance: tokenBalance / 1e18,
      walletBalance: walletBal,
      collateralBalance: collBal,
      priceUsd: tokenPrice / 1e18,
      valueUsd: tokenValueUsd,
      isLpToken: isLpToken || false,
      hasPool: !!(token?.pool),
      skipped: false,
    });
    
    netBalance += tokenValue;
  }

  // Add staked STRATO value to net balance
  const stakedStrato = snapshot.data.stakedStrato || 0n;
  let stakedValueUsd = 0;
  if (stakedStrato > 0n) {
    const stratoTokenAddr = snapshot.data.stratoTokenAddress || '';
    const stratoPrice = snapshot.data.tokens[stratoTokenAddr]?.price || 0;
    if (stratoPrice > 0) {
      const stakedValue = (Number(stakedStrato) / 1e9) * (stratoPrice / 1e9);
      stakedValueUsd = stakedValue / 1e18;
      contributions.push({
        bucket: 'STAKED',
        symbol: 'STRATO (Staked)',
        address: stratoTokenAddr,
        balance: Number(stakedStrato) / 1e18,
        walletBalance: 0,
        collateralBalance: 0,
        priceUsd: stratoPrice / 1e18,
        valueUsd: stakedValueUsd,
        isLpToken: false,
        hasPool: false,
        skipped: false
      });
      netBalance += stakedValue;
    } else {
      contributions.push({
        bucket: 'STAKED',
        symbol: 'STRATO (Staked)',
        address: stratoTokenAddr,
        balance: Number(stakedStrato) / 1e18,
        walletBalance: 0,
        collateralBalance: 0,
        priceUsd: 0,
        valueUsd: 0,
        isLpToken: false,
        hasPool: false,
        skipped: true,
        reason: `NO STRATO PRICE (token=${stratoTokenAddr || 'unset'})`
      });
    }
  }

  const cdpDebt = parseFloat(snapshot.data.userLoan?.scaledDebt || '0');
  netBalance -= netLoan + cdpDebt;
  const finalBalanceUsd = netBalance / 1e18;

  logNetBalanceBreakdown(
    `GRAPH POINT ${index} | ${snapshotDate}`,
    contributions,
    netLoan / 1e18,
    cdpDebt / 1e18,
    finalBalanceUsd,
  );
  return { timestamp: snapshot.timestamp, data: {netBalance: finalBalanceUsd }};
}

/**
 * Shared bucketed breakdown printer.
 * Both the live Net Balance box and every graph point print through this so the
 * two can be diffed section-by-section (WALLET / COLLATERAL / STAKED / ...).
 */
function logNetBalanceBreakdown(
  header: string,
  lines: Array<{
    bucket: string;
    symbol: string;
    balance: number;
    walletBalance: number;
    collateralBalance: number;
    priceUsd: number;
    valueUsd: number;
    skipped: boolean;
    reason?: string;
    note?: string;
    isLpToken?: boolean;
    hasPool?: boolean;
  }>,
  lendingDebt: number,
  cdpDebt: number,
  reportedNet: number,
) {
  const BUCKET_ORDER = ['WALLET', 'COLLATERAL', 'WALLET+COLLATERAL', 'STAKED', 'CARRY VAULT', 'DERIVED', 'UNKNOWN SOURCE'];
  const added = lines.filter((l) => !l.skipped && l.valueUsd > 0);
  const notAdded = lines.filter((l) => l.skipped || l.valueUsd <= 0);
  const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  console.log(`\n========== ${header} | NET: ${money(reportedNet)} ==========`);

  let assetTotal = 0;
  for (const bucket of BUCKET_ORDER) {
    const rows = added.filter((l) => l.bucket === bucket).sort((a, b) => b.valueUsd - a.valueUsd);
    if (rows.length === 0) continue;
    const bucketTotal = rows.reduce((s, r) => s + r.valueUsd, 0);
    assetTotal += bucketTotal;
    console.log(`  [${bucket}] ${rows.length} items | subtotal ${money(bucketTotal)}`);
    rows.slice(0, 25).forEach((r, i) => {
      const lp = r.isLpToken ? (r.hasPool ? ' [LP+POOL]' : ' [LP]') : '';
      console.log(
        `    ${(i + 1).toString().padStart(2)}. ${r.symbol.padEnd(26)} ${money(r.valueUsd).padStart(20)} | qty=${r.balance.toExponential(3)} | price=${money(r.priceUsd)}${lp}`
      );
      if (r.note) console.log(`        ↳ ${r.note}`);
    });
    if (rows.length > 25) console.log(`    ... and ${rows.length - 25} more`);
  }

  if (notAdded.length > 0) {
    console.log(`  [NOT ADDED] ${notAdded.length} items`);
    notAdded.slice(0, 20).forEach((r) => {
      const reason = r.reason || (r.valueUsd <= 0 ? 'VALUE = 0' : 'unknown');
      console.log(
        `    -   ${r.symbol.padEnd(26)} qty=${r.balance.toExponential(3)} | price=${money(r.priceUsd)} | ${reason}`
      );
    });
    if (notAdded.length > 20) console.log(`    ... and ${notAdded.length - 20} more`);
  }

  const totalDebt = lendingDebt + cdpDebt;
  console.log(`  [LOANS] lending=-${money(lendingDebt)} | cdp=-${money(cdpDebt)} | subtotal -${money(totalDebt)}`);
  console.log(`  ----------------------------------------------------------`);
  console.log(`  ASSETS  : ${money(assetTotal)}`);
  console.log(`  DEBT    : -${money(totalDebt)}`);
  console.log(`  NET     : ${money(reportedNet)}`);
  const drift = reportedNet - (assetTotal - totalDebt);
  if (Math.abs(drift) > 1) {
    console.log(`  DRIFT   : ${money(drift)} (logged buckets do not fully explain NET)`);
  }
  console.log(`==========================================================\n`);
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

  // Pre-fetch vault config and carry vault active request IDs in parallel (2 queries, not N+1)
  const carryVaultAddrs = listVaultDefs().filter(v => v.address).map(v => v.address);

  const [vaultConfig, activeReqMap] = await Promise.all([
    fetchVaultHistoryConfig(config.vault),
    fetchActiveRequestIds(carryVaultAddrs, userAddress).catch(() => new Map<string, string>()),
  ]);

  const requestFilters: { address: string; path: string }[] = [];
  for (const [addr, reqId] of activeReqMap) {
    requestFilters.push({ address: addr, path: `requests[${reqId}]` });
  }

  // Staking addresses for portfolio history
  const stratoStakingAddress = config.stratoStaking || '';
  const stratoTokenAddress = config.stratoToken || '';

  const carryVaultAddrSet = new Set(carryVaultAddrs);
  const initialData = {
    tokens: {},
    userLoan: {},
    vaultConfig: vaultConfig || undefined,
    carryVaultAddrs: carryVaultAddrSet,
    stratoTokenAddress,
    stakedStrato: 0n, // Total staked STRATO (delegated + unbonding)
  };

  const balanceHistory = await getHistoryDirect(
    historyParams,
    {
      vaultShareToken: vaultConfig?.shareToken,
      carryVaultAddrs,
    },
    {
      userAddress,
      botExecutor: vaultConfig?.botExecutor,
      carryVaultAddrs,
      requestFilters,
      priceOracle,
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

export const getNetBalance = async (
  accessToken: string,
  userAddress: string
): Promise<{ netBalance: number; totalBorrowed: number; totalAssetValue: number }> => {
  const [earningAssetsResult, loanResult, vaultsResult] = await Promise.allSettled([
    getEarningAssets(accessToken, userAddress),
    getLoan(accessToken, userAddress),
    getVaults(accessToken, userAddress),
  ]);

  let totalAssetValue = 0;
  const assetLines: Array<{
    bucket: string;
    symbol: string;
    balance: number;
    walletBalance: number;
    collateralBalance: number;
    priceUsd: number;
    valueUsd: number;
    skipped: boolean;
    reason?: string;
    note?: string;
  }> = [];

  if (earningAssetsResult.status === "fulfilled") {
    const toNum = (v: string | undefined) => {
      try { return Number(BigInt(v || "0")) / 1e18; } catch { return 0; }
    };

    for (const asset of earningAssetsResult.value) {
      const value = parseFloat(asset.value || "0");
      totalAssetValue += value;

      const symbol = asset._symbol || (asset as any).symbol || asset.address?.slice(0, 10) + "...";
      const wallet = toNum(asset.balance);
      const collateral = toNum(asset.collateralBalance);
      const staked = toNum((asset as any).stakedBalance);
      const price = toNum(asset.price);

      // saveUSDST / carry-vault assets derive `value` from redeemable/position USD
      // rather than qty × price, so they cannot be split into the qty buckets.
      const qtySum = wallet + collateral + staked;
      const impliedValue = qtySum * price;
      const isDerived = value > 0 && Math.abs(impliedValue - value) > Math.max(1, value * 0.01);

      if (value === 0 && qtySum === 0) continue;

      if (isDerived) {
        assetLines.push({
          bucket: 'DERIVED',
          symbol,
          balance: qtySum,
          walletBalance: wallet,
          collateralBalance: collateral,
          priceUsd: price,
          valueUsd: value,
          skipped: false,
          note: `value from vault formula, not qty×price (qty×price would be $${impliedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })})`,
        });
        continue;
      }

      if (value === 0) {
        assetLines.push({
          bucket: 'WALLET',
          symbol,
          balance: qtySum,
          walletBalance: wallet,
          collateralBalance: collateral,
          priceUsd: price,
          valueUsd: 0,
          skipped: true,
          reason: price === 0 ? 'NO PRICE' : 'VALUE = 0',
        });
        continue;
      }

      // Split the single asset into its qty buckets so each is comparable with
      // the graph's per-bucket totals.
      const pushBucket = (bucket: string, qty: number) => {
        if (qty <= 0) return;
        assetLines.push({
          bucket,
          symbol,
          balance: qty,
          walletBalance: bucket === 'WALLET' ? qty : 0,
          collateralBalance: bucket === 'COLLATERAL' ? qty : 0,
          priceUsd: price,
          valueUsd: qty * price,
          skipped: false,
        });
      };
      pushBucket('WALLET', wallet);
      pushBucket('COLLATERAL', collateral);
      pushBucket('STAKED', staked);
    }
  } else {
    console.log(`[NET BALANCE BOX] earning assets FAILED: ${earningAssetsResult.reason}`);
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
  let vaultCount = 0;
  if (vaultsResult.status === "fulfilled") {
    vaultCount = vaultsResult.value.length;
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
  const netBalance = totalAssetValue - totalBorrowed;

  logNetBalanceBreakdown(
    `NET BALANCE BOX | user=${userAddress} | ${vaultCount} cdp vaults`,
    assetLines,
    lendingDebt,
    cdpDebt,
    netBalance,
  );

  return {
    netBalance,
    totalBorrowed,
    totalAssetValue,
  };
};
