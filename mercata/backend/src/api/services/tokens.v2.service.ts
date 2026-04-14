import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getRebaseFactors } from "./oracle.service";
import { getVaultShareTokenAddress, getVaultHistoryConfig } from "./vault.service";
import { getSaveUsdstInfo, getSaveUsdstUserInfo } from "./saveUsdst.service";
import { getLoan } from "./lending.service";
import { getVaults } from "./cdp.service";
import { listVaultDefs, getYieldVaultInfo, getYieldVaultUserInfo } from "./yieldVault.service";
import { Token, EarningAsset, BalanceSnapshot } from "@mercata/shared-types";
import { buildTokenSelectFields } from "../../config/tokensConstants";
import { getHistory, HistoryParams, HistorySnapshot, MappingHistoryElement, StorageHistoryElement } from "../helpers/history.helper";
import { calculateLPTokenPrice } from "../helpers/swapping.helper";
import { getFactoryTokenAddresses } from "../helpers/cirrusHelpers";

const { Token, CollateralVault, CDPEngine, MercataBridge, mercataBridge, DECIMALS, YieldVault } = constants;

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
  const price = info.exchangeRate || "0";
  const redeemableValueUsd = userInfo?.redeemableAssets || "0";
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
    isPoolToken: false,
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
    isPoolToken: false,
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

  const { limit: limitStr, offset: offsetStr, ...queryParams } = params;

  const [response, rawPrices, factoryAddresses] = await Promise.all([
    cirrus.get(accessToken, "/" + Token, { params: queryParams }),
    getCompletePriceMap(accessToken),
    getFactoryTokenAddresses(accessToken),
  ]);

  if (response.status !== 200 || !response.data) {
    throw new Error(`Error fetching tokens: ${response.statusText}`);
  }

  const allTokens = (response.data as any[])
    .filter((token) => factoryAddresses.has(token.address))
    .map((token) => ({
      ...token,
      balance: token.balances?.[0]?.balance || "0",
      price: rawPrices.get(token.address) || "0",
    })) as Token[];

  const limit = parseInt(limitStr) || allTokens.length;
  const offset = parseInt(offsetStr) || 0;

  return {
    tokens: allTokens.slice(offset, offset + limit),
    totalCount: allTokens.length,
  };
};

export const getEarningAssets = async (
  accessToken: string,
  userAddress: string
): Promise<EarningAsset[]> => {
  const [tokens, collaterals, cdps, rawPrices, vaultShareToken, saveUsdstInfo, saveUsdstUserInfo, rebaseFactorMap, factoryAddresses] = await Promise.all([
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
    getVaultShareTokenAddress(accessToken),
    getSaveUsdstInfo(accessToken).catch(() => null),
    getSaveUsdstUserInfo(accessToken, userAddress).catch(() => null),
    getRebaseFactors(accessToken),
    getFactoryTokenAddresses(accessToken),
  ]);

  const collateralMap = new Map<string, bigint>();
  [...(collaterals.data || []), ...(cdps.data || [])].forEach((item: any) =>
    collateralMap.set(
      item.asset,
      (collateralMap.get(item.asset) || 0n) + BigInt(item.amount || "0")
    )
  );

  const factoryTokens = (tokens.data || []).filter((t: any) => factoryAddresses.has(t.address));

  const rebasingAddresses = factoryTokens
    .map((t: any) => t.address as string)
    .filter((addr: string) => rebaseFactorMap.has(addr));

  const rebasingExternalSymbolMap = await getRebasingExternalSymbols(accessToken, rebasingAddresses)
    .catch(() => new Map<string, string>());

  const earningAssets = factoryTokens.map((t: any) => {
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

    const rebaseFactor = rebaseFactorMap.get(t.address);
    const rebasingExternalSymbol = rebaseFactor ? rebasingExternalSymbolMap.get(t.address) : undefined;

    return {
      ...t,
      balance,
      price,
      collateralBalance,
      totalBalance: totalBalance.toString(),
      isPoolToken:
        t._symbol?.endsWith("-LP") ||
        t._symbol === "SUSDST" || t._symbol === "safetyUSDST" ||
        t._symbol === "MUSDST" || t._symbol === "lendUSDST" ||
        (vaultShareToken && t.address === vaultShareToken) ||
        t.description === "Liquidity Provider Token",
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
  const tokenParams: Record<string, string> = {
        select: buildTokenSelectFields({
          images: true,
          attributes: true,
          balance: false,
        }).join(","),
        status: "eq.2",
  };

  const [tokens, rawPrices, vaultShareToken, saveUsdstInfo, factoryAddresses] = await Promise.all([
    cirrus.get(accessToken, "/" + Token, { params: tokenParams }),
    getCompletePriceMap(accessToken),
    getVaultShareTokenAddress(accessToken),
    getSaveUsdstInfo(accessToken).catch(() => null),
    getFactoryTokenAddresses(accessToken),
  ]);

  const earningAssets = (tokens.data || [])
    .filter((t: any) => factoryAddresses.has(t.address))
    .map((t: any) => {
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
      isPoolToken:
        t._symbol?.endsWith("-LP") ||
        t._symbol === "SUSDST" || t._symbol === "safetyUSDST" ||
        t._symbol === "MUSDST" || t._symbol === "lendUSDST" ||
        (vaultShareToken && t.address === vaultShareToken) ||
        t.description === "Liquidity Provider Token",
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
    return { ...portfolioInfo,
      tokens: { ...portfolioInfo.tokens,
        [newInfo.address]: { ...portfolioInfo.tokens[newInfo.address],
          supply: totalSupply,
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
    if (snapshot.data.carryVaultAddrs?.has(tokenAddr)) {
      if (token?.userClaimableAssets) {
        const ulAsset = token?.underlyingAsset || '';
        const ulPrice = snapshot.data.tokens[ulAsset]?.price || 0;
        netBalance += (token.userClaimableAssets / 1000000000) * (ulPrice / 1000000000);
      }
      if (token?.userQueuedShares) {
        const supply = token?.supply || '0';
        if (supply !== '0') {
          const deployed = BigInt(token?.deployedAssets || 0);
          const claimable = BigInt(token?.totalClaimableAssets || 0);
          const idle = BigInt(token?.idleAssets || 0);
          const cvTotal = idle + deployed;
          const cvActive = cvTotal > claimable ? cvTotal - claimable : 0n;
          if (cvActive > 0n) {
            const ulAsset = token?.underlyingAsset || '';
            const ulPrice = snapshot.data.tokens[ulAsset]?.price || 0;
            const queuedAssets = Number((BigInt(Math.round(token.userQueuedShares)) * cvActive) / BigInt(supply));
            netBalance += (queuedAssets / 1000000000) * (ulPrice / 1000000000);
          }
        }
      }
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
      } else if (snapshot.data.vaultConfig?.shareToken === tokenAddr) { // Vault share token
        const supportedAssets: string[] = snapshot.data.vaultConfig?.supportedAssets || [];
        let totalEquity = 0n;
        for (const assetAddr of supportedAssets) {
          const bal = BigInt(snapshot.data.tokens[assetAddr]?.vaultAssetBalance || 0) || 0n;
          const assetPrice = BigInt(snapshot.data.tokens[assetAddr]?.price || 0) || 0n;
          if (assetPrice > 0n) {
            totalEquity += (bal * assetPrice) / BigInt(1e18);
          }
        }
        if (totalEquity > 0n) {
          tokenPrice = Number((totalEquity * BigInt(1e18)) / BigInt(totalSupply));
        }
      } else if (snapshot.data.carryVaultAddrs?.has(tokenAddr)) {
        const deployed = BigInt(token?.deployedAssets || 0);
        const claimable = BigInt(token?.totalClaimableAssets || 0);
        const idle = BigInt(token?.idleAssets || 0);
        const cvTotalAssets = idle + deployed;
        const cvActiveAssets = cvTotalAssets > claimable ? cvTotalAssets - claimable : 0n;
        const underlyingAsset = token?.underlyingAsset || '';
        const assetPrice = BigInt(snapshot.data.tokens[underlyingAsset]?.price || 0) || 0n;
        if (cvActiveAssets > 0n && assetPrice > 0n) {
          tokenPrice = Number((cvActiveAssets * assetPrice) / BigInt(totalSupply));
        }
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
  netBalance -= netLoan + parseFloat(snapshot.data.userLoan?.scaledDebt || '0');
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

  // Pre-fetch vault config and carry vault active request IDs in parallel
  const carryVaultAddrs = listVaultDefs().filter(v => v.address).map(v => v.address);
  const [vaultConfig, ...activeReqIds] = await Promise.all([
    getVaultHistoryConfig(accessToken),
    ...carryVaultAddrs.map(addr =>
      cirrus.get(accessToken, `/${YieldVault}-activeRequestId`, {
        params: { address: `eq.${addr}`, key: `eq.${userAddress}`, select: 'value::text' },
      }).then(r => r.data?.[0]?.value || "0").catch(() => "0")
    ),
  ]);

  const requestFilters: string[] = [];
  carryVaultAddrs.forEach((addr, i) => {
    if (activeReqIds[i] && activeReqIds[i] !== "0") {
      requestFilters.push(`and(address.eq.${addr},path.eq.requests[${activeReqIds[i]}])`);
    }
  });

  const storageFilters = [
    'data->>lpToken.neq.""',
    'data->>_symbol.like.*-LP',
    'data->>_symbol.in.(MUSDST,SUSDST,safetyUSDST,lendUSDST,saveUSDST)',
    'data->>sToken.gt.0',
    'and(data->>mToken.gt.0,data->>borrowIndex.gt.0)',
    ...(vaultConfig?.shareToken ? [`address.eq.${vaultConfig.shareToken}`] : []),
    ...carryVaultAddrs.map(addr => `address.eq.${addr}`),
  ]

  const mappingFilters = [
    `path.like.*${userAddress}*`,
    'path.like.prices[*',
    'path.like.collateralConfigs[*',
    'path.like.collateralGlobalStates[*',
    'and(address.eq.937efa7e3a77e20bbdbd7c0d32b6514f368c1010,path.eq._balances[0000000000000000000000000000000000001004])',
    ...(vaultConfig?.botExecutor ? [`path.eq._balances[${vaultConfig.botExecutor}]`] : []),
    ...carryVaultAddrs.map(addr => `path.eq._balances[${addr}]`),
    ...carryVaultAddrs.map(addr => `and(address.eq.${addr},path.eq.claimableAssets[${userAddress}])`),
    ...requestFilters,
  ]

  const mappingCollectionNames = [
    '_balances',
    'claimableAssets',
    'collateralConfigs',
    'collateralGlobalStates',
    'prices',
    ...(requestFilters.length ? ['requests'] : []),
    'userCollaterals',
    'userLoan',
    'vaults'
  ]

  const carryVaultAddrSet = new Set(carryVaultAddrs);
  const balanceHistory = await getHistory(
    accessToken,
    historyParams,
    storageFilters,
    mappingFilters,
    mappingCollectionNames,
    { tokens: {}, userLoan: {}, vaultConfig: vaultConfig || undefined, carryVaultAddrs: carryVaultAddrSet },
    updatePortfolioInfoStorage,
    updatePortfolioInfoMapping,
    processBalanceSnapshot
  );
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
  if (earningAssetsResult.status === "fulfilled") {
    for (const asset of earningAssetsResult.value) {
      totalAssetValue += parseFloat(asset.value || "0");
    }
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