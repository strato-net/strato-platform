import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getBalance, getTokens } from "./tokens.service";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";

const {
  registrySelectFields,
  lendingPool,
  LendingPool,
  LendingRegistry,
  PriceOracle,
  Token,
} = constants;

export const getPool = async (
  accessToken: string,
  options: Record<string, string> = {}
): Promise<Record<string, any>> => {
  const { select, ...filters } = options;
  const cleanedFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined)
  );
  const params = {
    ...cleanedFilters,
    select: select ?? registrySelectFields.join(","),
    ...(select
      ? {}
      : {
          "liquidityPool.deposited.value->>amount": "gt.0",
          "liquidityPool.borrowed.value->>amount": "gt.0",
        }),
    lendingPool: `eq.${lendingPool}`,
  };

  const {
    data: [poolData],
  } = await cirrus.get(accessToken, `/${LendingRegistry}`, { params });

  if (!poolData) {
    throw new Error(
      `Error fetching ${extractContractName(LendingRegistry)} data from Cirrus`
    );
  }

  // ---------------------------------------------------------------------------
  // Fallback: transform new userLoan mapping into the legacy "loans" shape that
  // downstream services expect. Also attach collateral info for each user so
  // health-factor calculations work again.
  // ---------------------------------------------------------------------------

  try {
    const lp = poolData.lendingPool || {};
    // Only enrich if legacy loans array is missing/empty but userLoan exists
    if ((!lp.loans || lp.loans.length === 0) && Array.isArray(lp.userLoan)) {
      const borrowableAsset = lp.borrowableAsset;

      // Build quick lookup map of all collateral per user
      const collateralEntries: any[] = poolData.collateralVault?.collaterals || [];
      const collateralMap = new Map<string, { asset: string; amount: string }[]>();

      const formatAmt = (v: any): string => {
        if (typeof v === "string") return v;
        if (typeof v === "number") {
          // Convert scientific notation to full integer string
          return v.toLocaleString("fullwide", { useGrouping: false });
        }
        return v?.toString?.() || "0";
      };

      const pushColl = (u: string, a: string, amtRaw: any) => {
        const amt = formatAmt(amtRaw);
        if (!u) return;
        const arr = collateralMap.get(u) || [];
        arr.push({ asset: a, amount: amt });
        collateralMap.set(u, arr);
      };

      collateralEntries.forEach((entry: any) => {
        const userKey: string = entry?.user ?? entry?.key ?? ""; // user column or legacy key
        const assetKey: string = entry?.asset ?? entry?.key2 ?? ""; // asset column if selected
        const valObj: any = entry?.Collateral ?? entry?.value ?? {};

        // Prefer columns first
        let user: string = userKey;
        let asset: string = assetKey;
        let amount: string = (entry?.amount ?? "").toString();

        // If columns empty fall back to object
        if (!user) user = valObj.user || "";
        if (!asset) asset = valObj.asset || "";

        // If still missing asset try composite key string
        const keyStr = entry?.key ?? "";
        if (!asset && keyStr.includes(",")) {
          asset = keyStr.split(",")[1] || "";
        }

        // Fallback: amount could be primitive
        if (!amount || amount === "[object Object]") {
          if (typeof entry.value === "string" || typeof entry.value === "number") {
            amount = entry.value.toString();
          }
        }

        pushColl(user, asset, amount);
      });

      // Convert each userLoan row into legacy LoanInfo format
      lp.loans = lp.userLoan.map((row: any) => {
        const key = row.key; // Should be user address
        const raw = row.LoanInfo ?? row.value ?? {};
        const principal = raw.principalBalance ?? raw.amount ?? "0";
        const lastUpdated = raw.lastUpdated ?? raw.lastIntCalculated ?? 0;

        const collArr = collateralMap.get(key) || [];
        const primaryColl = collArr[0] || { asset: "", amount: "0" };

        const loanInfo = {
          user: key,
          asset: borrowableAsset || "",
          amount: principal.toString(),
          collateralAsset: undefined,
          collateralAmount: undefined,
          collaterals: collArr,
          lastUpdated: lastUpdated.toString(),
          active: principal && principal.toString() !== "0",
        };

        return { key, LoanInfo: loanInfo };
      });

      // Once converted, drop userLoan to avoid duplicate arrays
      delete lp.userLoan;

      // ---------- Enrich loans with collateral USD values & health factor ----------
      const priceMapHF = new Map<string, bigint>(
        (poolData.oracle?.prices || []).map((p: any) => [p.asset.toLowerCase(), toBig(p.price)])
      );

      const ltMapHF = new Map<string, number>(
        (lp.assetConfigs || []).map((row: any) => [
          (row.asset || '').toLowerCase(),
          Number(row.AssetConfig?.liquidationThreshold || 0),
        ])
      );

      const calcHF = (loan: any): number => {
        const debtPrice = priceMapHF.get((loan.asset || '').toLowerCase()) || 0n;
        const debtValue = (toBig(loan.amount || 0) * debtPrice) / 10n ** 18n;
        if (debtValue === 0n) return Infinity;

        let numerator = 0n;
        (loan.collaterals || []).forEach((c: any) => {
          if (!c.asset) return;
          const price = priceMapHF.get(c.asset.toLowerCase()) || 0n;
          const val = (toBig(c.amount || 0) * price) / 10n ** 18n;
          const lt = BigInt(ltMapHF.get(c.asset.toLowerCase()) || 0);
          if (lt === 0n) return;
          numerator += val * lt;
        });

        if (numerator === 0n) return Infinity;
        // scale back by 1e4 because LT is in basis points
        return Number(numerator) / Number(debtValue * 10000n);
      };

      lp.loans = lp.loans.map((entry: any) => {
        const loan = entry.LoanInfo;

        // Enrich collaterals with USD value
        loan.collaterals = (loan.collaterals || []).map((c: any) => {
          const price = priceMapHF.get((c.asset || '').toLowerCase()) || 0n;
          const usd = ((toBig(c.amount || 0) * price) / 10n ** 18n).toString();
          return { ...c, usdValue: usd };
        });

        const hfVal = calcHF(loan);
        return { ...entry, healthFactor: isFinite(hfVal) ? hfVal : null };
      });

      // remove redundant arrays now that assetConfigs exists
      delete lp.ltv;
      delete lp.liquidationBonus;
    }

    // ---------------------------------------------------------------------
    // Derive legacy arrays (interestRate, ltv, liquidationBonus) from the
    // new assetConfigs mapping so downstream logic keeps working.
    // ---------------------------------------------------------------------

    if (Array.isArray(lp.assetConfigs)) {
      if (!lp.interestRate) {
        lp.interestRate = lp.assetConfigs.map((row: any) => {
          const rate = row.AssetConfig?.interestRate ?? row.AssetConfig?.rate ?? 0;
          return { asset: row.asset, rate };
        });
      }
      if (!lp.ltv) {
        lp.ltv = lp.assetConfigs.map((row: any) => {
          const ltvVal = row.AssetConfig?.ltv ?? 0;
          return { asset: row.asset, ltv: ltvVal };
        });
      }
      if (!lp.liquidationBonus) {
        lp.liquidationBonus = lp.assetConfigs.map((row: any) => {
          const bonus = row.AssetConfig?.liquidationBonus ?? 0;
          return { asset: row.asset, bonus };
        });
      }
    }

    // Final clean-up: remove redundant arrays
    delete lp.ltv;
    delete lp.liquidationBonus;
  } catch (err) {
    // Silently swallow enrichment errors – better to return raw data than break API
    console.error("[getPool] loan enrichment failed", err);
  }

  return poolData;
};

export const depositLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const { liquidityPool } = await getPool(accessToken, { select: "liquidityPool" });
    if (!liquidityPool) {
      throw new Error("Liquidity pool address not found");
    }

    const tx: FunctionInput[] = [
      {
        contractName: extractContractName(Token),
        contractAddress: body.asset || "",
        method: "approve",
        args: {
          spender: liquidityPool,
          value: body.amount || "",
        },
      },
      {
        contractName: extractContractName(LendingPool),
        contractAddress: constants.lendingPool,
        method: "depositLiquidity",
        args: {
          asset: body.asset,
          amount: body.amount,
        },
      }
    ];

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const withdrawLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx: FunctionInput[] = [{
      contractName: extractContractName(LendingPool),
      contractAddress: constants.lendingPool,
      method: "withdrawLiquidity",
      args: {
        asset: body.asset,
        amount: body.amount,
      },
    }];

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const borrow = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const lendingPool = await getPool(accessToken, {
      select: "collateralVault",
    });

    if (!lendingPool.collateralVault) {
      throw new Error("Collateral vault address not found");
    }

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: body.collateralAsset || "",
        method: "approve",
        args: { spender: lendingPool.collateralVault, value: body.collateralAmount || "" },
      },
      {
        contractName: extractContractName(LendingPool),
        contractAddress: constants.lendingPool,
        method: "borrow",
        args: {
          asset: body.asset,
          amount: body.amount,
          collateralAsset: body.collateralAsset,
          collateralAmount: body.collateralAmount,
        },
      }
    ]);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const repay = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    // Fetch liquidityPool address quickly (avoid heavy nested select)
    const poolMeta = await getPool(accessToken, { select: "liquidityPool" });

    // Separate full fetch to access loans & rate maps
    const lendingPoolInfo = await getPool(accessToken);

    if (!poolMeta?.liquidityPool) {
      throw new Error("Liquidity pool address not found");
    }

    const loanEntry = (lendingPoolInfo.lendingPool.loans || []).find(
      (e: any) => e.key === body.loanId
    );
    if (!loanEntry) {
      throw new Error(`Loan ${body.loanId} not found`);
    }
    const loan = loanEntry.LoanInfo;

    // Calculate up-to-date interest so we can determine the exact outstanding.
    const now = Math.floor(Date.now() / 1000);
    const { priceMap, ratioMap } = buildMaps(lendingPoolInfo);
    const rateArray = lendingPoolInfo.lendingPool.interestRate || [];
    const rateObj = rateArray.find((r: any) => r.asset?.toLowerCase() === loan.asset.toLowerCase());
    const rateNum = rateObj ? Number(rateObj.rate) : 0; // may be decimal percentage like 0.5
    const rateScaled = Math.round(rateNum * 100); // scale to integer (percent *100) for 2-decimal precision
    const durationSec = Math.max(0, now - Number(loan.lastUpdated));
    const bufferSec = 600; // 10-min buffer
    const hoursElapsed = BigInt(Math.floor((durationSec + bufferSec) / 3600)); // whole hours, ensures at least one hour after buffer
    const interest =
      (toBig(loan.amount) * BigInt(rateScaled) * hoursElapsed) /
      BigInt(8760 * 100 * 100); // extra *100 due to scaling
    const totalOwed = (toBig(loan.amount) + interest).toString();

    // Allow partial repayments. If caller over-pays, clip to the exact amount owed.
    let repayAmount = body.amount || totalOwed;
    if (toBig(repayAmount) > toBig(totalOwed)) {
      repayAmount = totalOwed;
    }

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: body.asset || loan.asset,
        method: "approve",
        args: {
          spender: poolMeta.liquidityPool,
          value: repayAmount,
        },
      },
      {
        contractName: extractContractName(LendingPool),
        contractAddress: constants.lendingPool,
        method: "repayLoan",
        args: {
          loanId: body.loanId,
          amount: repayAmount,
        },
      },
    ]);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const getDepositableTokens = async (
  accessToken: string,
  address: string
) => {
  const [registry, userTokens] = await Promise.all([
    getPool(accessToken),
    getBalance(accessToken, address),
  ]);

  const userTokenMap = new Map(userTokens.map((t: any) => [t.address, t]));
  const oraclePriceMap = new Map(
    (registry.oracle.prices || []).map(
      ({ asset, price }: { asset: string; price: string }) => [asset, price]
    )
  );
  const interestRateMap = new Map<string, number>(
    (registry.lendingPool.interestRate || []).map((entry: any) => {
      const assetAddr = (entry?.asset || "").toLowerCase();
      return [assetAddr, Number(entry?.rate || 0)];
    })
  );
  const liquidityMap = new Map(
    (registry.liquidityPool.totalLiquidity || []).map(
      ({ asset, amount }: { asset: string; amount: string }) => [asset, amount]
    )
  );
  const collateralConfigs = registry.lendingPool.ltv || registry.lendingPool.collateralRatio || [];
  return collateralConfigs
    .filter(
      ({ asset }: any) =>
        oraclePriceMap.has(asset) !== undefined && userTokenMap.has(asset)
    )
    .map((entry: any) => {
      const asset = entry.asset;
      const ratioVal = entry.ratio ?? entry.ltv ?? 0;
      const userToken = userTokenMap.get(asset) as any;
      return {
        address: asset,
        _name: userToken?.token?._name || "",
        _symbol: userToken?.token?._symbol || "",
        value: userToken?.balance?.toString() || "0",
        collateralRatio: ratioVal,
        interestRate: interestRateMap.get(asset) || 0,
        price: oraclePriceMap.get(asset) || "0",
        liquidity: liquidityMap.get(asset) || "0",
      };
    });
};

export const getWithdrawableTokens = async (
  accessToken: string,
  address: string
): Promise<
  { address: string; _name: string; _symbol: string; value: string }[]
> => {
  const registry = await getPool(accessToken);

  const userDeposits = Object.values(registry.liquidityPool?.deposited || {})
    .map((entry: any) => entry.Deposit)
    .filter((d: any) => d.user === address) as {
    asset: string;
    amount: string;
    user: string;
  }[];

  if (!userDeposits.length) return [];

  const tokenMetadata = await getTokens(accessToken, {
    address: `in.(${userDeposits.map((d) => d.asset).join(",")})`,
  });

  const tokenMap = new Map(tokenMetadata.map((t: any) => [t.address, t]));

  return userDeposits
    .filter((d) => tokenMap.has(d.asset))
    .map((d) => {
      const token = tokenMap.get(d.asset) as any;
      return {
        address: d.asset,
        _name: token?._name || "",
        _symbol: token?._symbol || "",
        value: d.amount || "0",
      };
    });
};

export const getLoans = async (
  accessToken: string,
  address: string
): Promise<{ key: string; loan: any }[]> => {
  const registry = await getPool(accessToken);

  // Build quick lookup map for interest rates (percent per annum)
  const interestRateMap = new Map<string, number>(
    (registry.lendingPool.interestRate || []).map((entry: any) => {
      const assetAddr = (entry?.asset || "").toLowerCase();
      return [assetAddr, Number(entry?.rate || 0)];
    })
  );

  // Filter user-specific loans
  const userLoans = (registry.lendingPool.loans || []).filter(
    (entry: any) => entry.LoanInfo.user.toLowerCase() === address.toLowerCase()
  );

  const combinedLoans = userLoans;

  if (!combinedLoans.length) return [];

  // Collect all unique token addresses used in loans
  const tokenAddresses = [
    ...new Set(
      combinedLoans.flatMap((entry: any) => {
        const base = [entry.LoanInfo.asset];
        const collArr = entry.LoanInfo.collaterals || [];
        if (collArr.length) {
          return base.concat(collArr.map((c: any) => c.asset));
        }
        return base.concat(entry.LoanInfo.collateralAsset);
      })
    ),
  ];

  // Fetch token metadata and build a lookup map
  const tokenMap = new Map(
    (
      await getTokens(accessToken, {
        address: `in.(${tokenAddresses.join(",")})`,
      })
    ).map((t: any) => [t.address, t])
  );

  const now = Math.floor(Date.now() / 1000);
  const { priceMap, ratioMap } = buildMaps(registry);

  // Return structured array of enriched loan objects
  return combinedLoans.map((entry: any) => {
    const loan = entry.LoanInfo;
    const key = entry.key;

    const assetToken = tokenMap.get(loan.asset) as any;
    const collateralToken = tokenMap.get(loan.collateralAsset) as any;

    const hf = calculateHealthFactor(loan, priceMap, ratioMap);

    // Enrich collaterals with metadata & USD value
    const collateralsEnriched = (loan.collaterals || []).map((c: any) => {
      const tok = tokenMap.get(c.asset) || {};
      const price = priceMap.get((c.asset || "").toLowerCase()) || 0n;
      const usd = ((toBig(c.amount || 0) * price) / 10n ** 18n).toString();
      return {
        asset: c.asset,
        amount: c.amount,
        symbol: tok?._symbol || "",
        name: tok?._name || "",
        usdValue: usd,
      };
    });

    // Backwards-compat collateralSymbol etc use first collateral
    const firstColl = collateralsEnriched[0] || { symbol: "", name: "" };

    const loanResp: any = {
      ...loan,
      assetName: assetToken?._name || "",
      assetSymbol: assetToken?._symbol || "",
      collateralName: firstColl.name,
      collateralSymbol: firstColl.symbol,
      collaterals: collateralsEnriched,
      interest: loan.lastUpdated
        ? (
            (toBig(loan.amount) *
              BigInt(interestRateMap.get(loan.asset.toLowerCase()) || 0) *
              BigInt(Math.floor((Math.max(0, now - Number(loan.lastUpdated))) / 3600))) /
            BigInt(8760 * 100)
          ).toString()
        : "0",
      healthFactor: hf,
    };
    delete loanResp.collateralAsset;
    delete loanResp.collateralAmount;

    return { key, healthFactor: hf, loan: loanResp };
  });
};

// ---------------- Liquidation services ----------------

/** Build quick lookup maps needed for HF calculation */
const buildMaps = (registry: any) => {
  const priceMap = new Map<string, bigint>(
    (registry.oracle.prices || []).map((p: any) => [p.asset.toLowerCase(), toBig(p.price)])
  );
  const collateralEntries = registry.lendingPool.ltv || registry.lendingPool.collateralRatio || [];
  const ratioMap = new Map<string, number>(
    collateralEntries.map((r: any) => {
      const assetAddr = (r.asset || "").toLowerCase();
      const val = r.ltv ?? r.ratio ?? 0;
      return [assetAddr, Number(val)];
    })
  );
  return { priceMap, ratioMap };
};

const calculateHealthFactor = (
  loan: any,
  priceMap: Map<string, bigint>,
  ratioMap: Map<string, number>
) => {
  const loanPrice = priceMap.get(loan.asset.toLowerCase()) || 0n;
  const loanValue = (toBig(loan.amount) * loanPrice) / 10n ** 18n;
  if (loanValue === 0n) return Infinity;

  // Handle multi-collateral
  const collArr: { asset: string; amount: string }[] = loan.collaterals || [
    { asset: loan.collateralAsset, amount: loan.collateralAmount },
  ];

  let thresholdValue = 0n;
  for (const c of collArr) {
    if (!c.asset) continue;
    const p = priceMap.get(c.asset.toLowerCase()) || 0n;
    const amt = toBig(c.amount || 0);
    const val = (amt * p) / 10n ** 18n; // USD value
    const ratio = BigInt(ratioMap.get(c.asset.toLowerCase()) || 0); // basis points
    if (ratio === 0n) continue;
    // Effective value before liquidation threshold: (coll * 100) / ratio
    thresholdValue += (val * 100n) / ratio;
  }

  if (thresholdValue === 0n) return Infinity;
  return Number((thresholdValue * 10000n) / loanValue) / 10000; // 4-dec precision
};

export const listLiquidatableLoans = async (accessToken: string) => {
  const registry = await getPool(accessToken);
  const { priceMap, ratioMap } = buildMaps(registry);

  const loans = (registry.lendingPool.loans || []) as any[];

  // Fetch token metadata for all unique addresses involved
  const tokenAddresses = [
    ...new Set(
      loans.flatMap((e) => {
        const base = [e.LoanInfo.asset];
        const nodes = e.LoanInfo.collaterals?.map((c: any) => c.asset) || [];
        return base.concat(nodes);
      })
    ),
  ];

  const tokenMap = new Map(
    (
      await getTokens(accessToken, {
        address: `in.(${tokenAddresses.join(',')})`,
      })
    ).map((t: any) => [t.address, t])
  );

  return loans
    .filter((e) => e.LoanInfo?.active)
    .map((e) => {
      const loan = e.LoanInfo;
      const hf = e.healthFactor ?? calculateHealthFactor(loan, priceMap, ratioMap);

      const primaryCollAsset = (loan.collaterals && loan.collaterals[0]?.asset) || loan.collateralAsset || "";

      const assetToken = tokenMap.get(loan.asset) as any;
      const collToken = primaryCollAsset ? tokenMap.get(primaryCollAsset) as any : {};

      // Determine close factor: 1.0 if HF < 0.95, else 0.5
      const closeFactorNum = hf < 0.95 ? 100n : 50n; // 100% or 50%
      const repayAmount = (toBig(loan.amount) * closeFactorNum) / 100n;

      const collateralsWithProfit = (loan.collaterals || []).map((c: any) => {
        if (!c.asset) return { ...c, expectedProfit: "0" };

        const tokenMeta = tokenMap.get(c.asset) as any;
        const symbol = tokenMeta?._symbol || "";

        const acEntry = registry.lendingPool.assetConfigs?.find?.((ac: any) => ac.asset === c.asset);
        const bonusBp = acEntry ? BigInt(acEntry.AssetConfig?.liquidationBonus ?? 10500) : 10500n;

        const collPrice = priceMap.get(c.asset.toLowerCase()) || 0n;
        const loanPrice = priceMap.get(loan.asset.toLowerCase()) || 0n;
        const availableTokens = toBig(c.amount);

        // Seize amount calculated per Aave-style formula (collateral tokens)
        let seizeTheory = 0n;
        if (collPrice > 0n) {
          seizeTheory = (repayAmount * bonusBp * loanPrice) / (collPrice * 10000n);
        }

        const seizeAmt = seizeTheory > availableTokens ? availableTokens : seizeTheory;

        const profitWei = (seizeAmt * collPrice) / 1_000000000000000000n - (repayAmount * loanPrice) / 1_000000000000000000n;

        const usdVal = ((availableTokens * collPrice) / 10n ** 18n).toString();

        return { ...c, symbol, usdValue: usdVal, expectedProfit: profitWei.toString() };
      });

      loan.collaterals = collateralsWithProfit;

      return {
        id: e.key,
        healthFactor: hf,
        assetSymbol: assetToken?._symbol || '',
        collateralSymbol: collToken?._symbol || '',
        ...loan,
      };
    })
    .filter((l) => l.healthFactor < 1);
};

export const listNearUnhealthyLoans = async (
  accessToken: string,
  margin: number
) => {
  const registry = await getPool(accessToken);
  const { priceMap, ratioMap } = buildMaps(registry);
  const upper = 1 + margin;
  const loans = (registry.lendingPool.loans || []) as any[];

  const tokenAddresses = [
    ...new Set(
      loans.flatMap((e) => {
        const arr = [e.LoanInfo.asset];
        const collArr = e.LoanInfo.collaterals || [];
        if (collArr.length) arr.push(...collArr.map((c: any) => c.asset));
        else arr.push(e.LoanInfo.collateralAsset);
        return arr;
      })
    ),
  ];
  const tokenMap = new Map(
    (
      await getTokens(accessToken, {
        address: `in.(${tokenAddresses.join(',')})`,
      })
    ).map((t: any) => [t.address, t])
  );

  return loans
    .filter((e) => e.LoanInfo?.active)
    .map((e) => {
      const loan = e.LoanInfo;
      const hf = e.healthFactor ?? calculateHealthFactor(loan, priceMap, ratioMap);
      const primaryCollAsset = (loan.collaterals && loan.collaterals[0]?.asset) || loan.collateralAsset || "";

      const assetToken = tokenMap.get(loan.asset) as any;
      const collToken = primaryCollAsset ? tokenMap.get(primaryCollAsset) as any : {};

      return {
        id: e.key,
        healthFactor: hf,
        assetSymbol: assetToken?._symbol || '',
        collateralSymbol: collToken?._symbol || '',
        ...loan,
      };
    })
    .filter((l) => l.healthFactor >= 1 && l.healthFactor < upper);
};

export const getLoanByIdDirect = async (
  accessToken: string,
  id: string
) => {
  const registry = await getPool(accessToken);
  const found = (registry.lendingPool.loans || []).find((e: any) => e.key === id);
  if (!found) return null;
  return found.LoanInfo;
};

export const executeLiquidation = async (
  accessToken: string,
  loanId: string
) => {
  // Fetch liquidityPool address directly to avoid accidentally passing the whole object
  const { liquidityPool } = await getPool(accessToken, { select: "liquidityPool" });
  if (!liquidityPool || typeof liquidityPool !== "string") {
    throw new Error("Liquidity pool address not found");
  }
  const liquidityPoolAddr = liquidityPool;

  // Fetch full registry to locate the loan details
  const registry = await getPool(accessToken);
  const found = (registry.lendingPool.loans || []).find((e: any) => e.key === loanId);
  if (!found) {
    throw new Error(`Loan ${loanId} not found`);
  }
  const loan = found.LoanInfo;

  // Determine up-to-date interest and allowed repay cap (50% or full)
  const now = Math.floor(Date.now() / 1000);
  const rateArr = registry.lendingPool.interestRate || [];
  const rateObj = rateArr.find((r: any) => r.asset?.toLowerCase() === loan.asset.toLowerCase());
  const rateNum = rateObj ? Number(rateObj.rate) : 0;
  const rateScaled = Math.round(rateNum * 100);
  const durationSec = Math.max(0, now - Number(loan.lastUpdated));
  const interestAcc = (toBig(loan.amount) * BigInt(rateScaled) * BigInt(Math.floor(durationSec / 3600))) / BigInt(8760 * 100 * 100);
  const totalOwed = toBig(loan.amount) + interestAcc;

  // health factor already computed earlier in listLiquidatable etc. Compute again quickly
  const { priceMap, ratioMap } = buildMaps(registry);
  const hf = calculateHealthFactor(loan, priceMap, ratioMap);

  let repayAmount = totalOwed;
  if (hf >= 0.95) {
    repayAmount = totalOwed / 2n; // 50%
  }

  const tx = buildFunctionTx([
    {
      contractName: extractContractName(Token),
      contractAddress: loan.asset,
      method: "approve",
      args: { spender: liquidityPoolAddr, value: repayAmount.toString() },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: constants.lendingPool,
      method: "liquidationCall",
      args: {
        collateralAsset: loan.collateralAsset,
        borrower: loan.user,
        debtToCover: repayAmount.toString(),
      },
    },
  ]);

  try {
    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error: any) {
    throw error;
  }
};

export const getLoanWithHealthFactor = async (
  accessToken: string,
  id: string
) => {
  const registry = await getPool(accessToken);
  const found = (registry.lendingPool.loans || []).find((e: any) => e.key === id);
  if (!found) return null;
  const loan = found.LoanInfo;
  const { priceMap, ratioMap } = buildMaps(registry);
  const healthFactor = calculateHealthFactor(loan, priceMap, ratioMap);
  return { id, healthFactor, ...loan };
};

const toBig = (v: string | number | bigint | undefined | null) => {
  if (v === undefined || v === null) return 0n;
  return BigInt(v);
};

export const setInterestRate = async (
  accessToken: string,
  body: Record<string, string | number>
) => {
  if (!body.asset || body.rate === undefined) {
    throw new Error("Missing required parameters: asset and rate");
  }

  const rateValue = Number(body.rate);
  if (isNaN(rateValue) || rateValue < 0 || rateValue > 100) {
    throw new Error("Interest rate must be a number between 0 and 100");
  }

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: constants.poolConfigurator,
    method: "setInterestRate",
    args: { 
      asset: body.asset, 
      newRate: rateValue
    },
  });

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

export const setCollateralRatio = async (
  accessToken: string,
  body: Record<string, string | number>
) => {
  if (!body.asset || body.ratio === undefined) {
    throw new Error("Missing required parameters: asset and ratio");
  }

  const ratioValue = Number(body.ratio);
  if (isNaN(ratioValue) || ratioValue < 100 || ratioValue > 1000) {
    throw new Error("Collateral ratio must be a number between 100 and 1000");
  }

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: constants.poolConfigurator,
    method: "setCollateralRatio",
    args: { 
      asset: body.asset, 
      newRatio: ratioValue
    },
  });

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

export const setLiquidationBonus = async (
  accessToken: string,
  body: Record<string, string | number>
) => {
  if (!body.asset || body.bonus === undefined) {
    throw new Error("Missing required parameters: asset and bonus");
  }

  const bonusValue = Number(body.bonus);
  if (isNaN(bonusValue) || bonusValue < 100 || bonusValue > 200) {
    throw new Error("Liquidation bonus must be a number between 100 and 200");
  }

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: constants.poolConfigurator,
    method: "setLiquidationBonus",
    args: { 
      asset: body.asset, 
      newBonus: bonusValue
    },
  });

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};
