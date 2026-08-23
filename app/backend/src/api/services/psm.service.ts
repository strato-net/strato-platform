import { strato, cirrus } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import JSONBig from "json-bigint";

const { DirectMintPSM, Token, SaveUSDSTVault } = constants;
const JSONbigString = JSONBig({ storeAsString: true });

const normalizeAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const parseStructValue = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSONbigString.parse(value); } catch { return {}; }
  }
  if (typeof value === "object") return value as Record<string, any>;
  return {};
};

const parseTupleValue = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""));
};

const toIntegerString = (value: unknown): string => {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return value.toLocaleString("fullwide", { useGrouping: false });
  }
  const raw = String(value ?? "0").trim();
  return /^-?\d+$/.test(raw) ? raw : "0";
};

const toBigInt = (value: unknown): bigint => {
  try {
    return BigInt(toIntegerString(value));
  } catch {
    return 0n;
  }
};

const toBoolean = (value: unknown): boolean =>
  value === true || ["true", "t"].includes(String(value).toLowerCase());

const isZeroAddress = (value: string): boolean => !value || /^0+$/.test(value);

const getPsmAddress = (): string => {
  const addr = constants.directMintPsm;
  if (!addr) throw new Error("DirectMintPSM not configured for this network");
  return addr;
};

interface MintConfigInfo {
  isEnabled: boolean;
  maxBalance: string;
  feeBps: string;
}

interface BurnConfigInfo {
  isEnabled: boolean;
  minReserve: string;
  feeBps: string;
}

const parseMintConfig = (value: unknown): MintConfigInfo => {
  const parsed = parseStructValue(value);
  const tuple = parseTupleValue(value);
  return {
    isEnabled: toBoolean(parsed.isEnabled ?? tuple[0]),
    maxBalance: toIntegerString(parsed.maxBalance ?? tuple[1]),
    feeBps: toIntegerString(parsed.feeBps ?? tuple[2]),
  };
};

const parseBurnConfig = (value: unknown): BurnConfigInfo => {
  const parsed = parseStructValue(value);
  const tuple = parseTupleValue(value);
  return {
    isEnabled: toBoolean(parsed.isEnabled ?? tuple[0]),
    minReserve: toIntegerString(parsed.minReserve ?? tuple[1]),
    feeBps: toIntegerString(parsed.feeBps ?? tuple[2]),
  };
};

export interface PsmMintState {
  mintableToken: string;
  mintPaused: boolean;
  mintConfigs: Map<string, MintConfigInfo>;
}

export const getPsmMintState = async (accessToken: string): Promise<PsmMintState> => {
  const psmAddress = getPsmAddress();
  const [psmResponse, mintConfigResponse] = await Promise.all([
    cirrus.get(accessToken, `/${DirectMintPSM}`, {
      params: {
        address: `eq.${psmAddress}`,
        select: "mintableToken,mintPaused",
        limit: "1",
      },
    }),
    cirrus.get(accessToken, `/${DirectMintPSM}-mintConfigs`, {
      params: {
        address: `eq.${psmAddress}`,
        select: "key,value::text",
      },
    }),
  ]);

  return {
    mintableToken: normalizeAddress(psmResponse.data?.[0]?.mintableToken),
    mintPaused: toBoolean(psmResponse.data?.[0]?.mintPaused),
    mintConfigs: new Map(
      (mintConfigResponse.data || []).map((entry: any) => [
        normalizeAddress(entry.key),
        parseMintConfig(entry.value),
      ])
    ),
  };
};

export interface PsmInfo {
  address: string;
  mintableToken: string;
  mintableTokenSymbol: string;
  mintPaused: boolean;
  burnPaused: boolean;
  savingsVault: string;
  savingsEnabled: boolean;
  eligibleTokens: Array<{
    address: string;
    symbol: string;
    name: string;
    userBalance: string;
    psmBalance: string;
    mintEnabled: boolean;
    burnEnabled: boolean;
    maxBalance: string;
    minReserve: string;
    mintFeeBps: string;
    burnFeeBps: string;
    availableLiquidity: string;
  }>;
  userMintableBalance: string;
}

/**
 * Mirrors DirectMintPSM.savingsDepositAvailable so the UI can hide the
 * "mint into savings" option instead of letting the user pay for a revert.
 * The dust check (deposits that round to zero shares) is left to the contract.
 */
const getSavingsEnabled = async (
  accessToken: string,
  savingsVault: string,
  mintableToken: string
): Promise<boolean> => {
  if (isZeroAddress(savingsVault) || !mintableToken) return false;

  try {
    const [vaultResponse, vaultBalanceResponse] = await Promise.all([
      cirrus.get(accessToken, `/${SaveUSDSTVault}`, {
        params: {
          address: `eq.${savingsVault}`,
          select: "assetToken,vaultInitialized,_paused,_totalSupply::text,_managedAssets::text",
          limit: "1",
        },
      }),
      cirrus.get(accessToken, `/${Token}-_balances`, {
        params: {
          address: `eq.${mintableToken}`,
          key: `eq.${savingsVault}`,
          select: "value::text",
          limit: "1",
        },
      }),
    ]);

    const vault = vaultResponse.data?.[0];
    if (!vault) return false;
    if (!toBoolean(vault.vaultInitialized)) return false;
    if (toBoolean(vault._paused)) return false;
    if (normalizeAddress(vault.assetToken) !== mintableToken) return false;

    const totalShares = toBigInt(vault._totalSupply);
    if (totalShares === 0n) return true;

    // Pricing assets are capped by the vault's live balance, as the vault does.
    const managedAssets = toBigInt(vault._managedAssets);
    const liveBalance = toBigInt(vaultBalanceResponse.data?.[0]?.value);
    const pricingAssets = liveBalance < managedAssets ? liveBalance : managedAssets;
    return pricingAssets > 0n;
  } catch (error) {
    console.warn("Failed to resolve PSM savings availability:", error);
    return false;
  }
};

export const getPsmInfo = async (
  accessToken: string,
  userAddress: string
): Promise<PsmInfo> => {
  const psmAddress = getPsmAddress();
  const normalizedUser = normalizeAddress(userAddress);

  // 1. PSM contract state
  const psmResponse = await cirrus.get(accessToken, `/${DirectMintPSM}`, {
    params: {
      address: `eq.${psmAddress}`,
      select: "mintableToken,mintPaused,burnPaused,savingsVault",
    },
  });
  const psm = psmResponse.data?.[0] || {};
  const mintableToken = normalizeAddress(psm.mintableToken);
  const savingsVault = normalizeAddress(psm.savingsVault);

  // 2. Per-token PSM configs
  const [mintConfigResponse, burnConfigResponse] = await Promise.all([
    cirrus.get(accessToken, `/${DirectMintPSM}-mintConfigs`, {
      params: {
        address: `eq.${psmAddress}`,
        select: "key,value::text",
      },
    }),
    cirrus.get(accessToken, `/${DirectMintPSM}-burnConfigs`, {
      params: {
        address: `eq.${psmAddress}`,
        select: "key,value::text",
      },
    }),
  ]);

  const mintConfigs: Record<string, MintConfigInfo> = {};
  for (const entry of mintConfigResponse.data || []) {
    mintConfigs[normalizeAddress(entry.key)] = parseMintConfig(entry.value);
  }

  const burnConfigs: Record<string, BurnConfigInfo> = {};
  for (const entry of burnConfigResponse.data || []) {
    burnConfigs[normalizeAddress(entry.key)] = parseBurnConfig(entry.value);
  }

  const eligibleAddresses = [
    ...new Set([...Object.keys(mintConfigs), ...Object.keys(burnConfigs)]),
  ].filter(Boolean);

  // 3. Token metadata
  const allTokenAddresses = [
    ...new Set([...eligibleAddresses, mintableToken]),
  ].filter(Boolean);

  let tokenMeta: Record<string, { symbol: string; name: string }> = {};
  if (allTokenAddresses.length > 0) {
    const metaResponse = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `in.(${allTokenAddresses.join(",")})`,
        select: "address,_name,_symbol",
      },
    });
    for (const t of metaResponse.data || []) {
      tokenMeta[normalizeAddress(t.address)] = {
        symbol: t._symbol || "",
        name: t._name || "",
      };
    }
  }

  // 4. User balances for all relevant tokens
  let userBalances: Record<string, string> = {};
  if (allTokenAddresses.length > 0) {
    const userBalResponse = await cirrus.get(
      accessToken,
      `/${Token}-_balances`,
      {
        params: {
          address: `in.(${allTokenAddresses.join(",")})`,
          key: `eq.${normalizedUser}`,
          select: "address,value::text",
        },
      }
    );
    for (const b of userBalResponse.data || []) {
      userBalances[normalizeAddress(b.address)] = b.value || "0";
    }
  }

  // 5. PSM reserve balances for eligible tokens
  let psmBalances: Record<string, string> = {};
  if (eligibleAddresses.length > 0) {
    const psmBalResponse = await cirrus.get(accessToken, `/${Token}-_balances`, {
      params: {
        address: `in.(${eligibleAddresses.join(",")})`,
        key: `eq.${psmAddress}`,
        select: "address,value::text",
      },
    });
    for (const b of psmBalResponse.data || []) {
      psmBalances[normalizeAddress(b.address)] = b.value || "0";
    }
  }

  // 6. Whether minting can currently be routed into the savings vault
  const savingsEnabled = await getSavingsEnabled(accessToken, savingsVault, mintableToken);

  return {
    address: psmAddress,
    mintableToken,
    mintableTokenSymbol: tokenMeta[mintableToken]?.symbol || "USDST",
    mintPaused: toBoolean(psm.mintPaused),
    burnPaused: toBoolean(psm.burnPaused),
    savingsVault: isZeroAddress(savingsVault) ? "" : savingsVault,
    savingsEnabled,
    eligibleTokens: eligibleAddresses.map((addr) => ({
      address: addr,
      symbol: tokenMeta[addr]?.symbol || "",
      name: tokenMeta[addr]?.name || "",
      userBalance: userBalances[addr] || "0",
      psmBalance: psmBalances[addr] || "0",
      mintEnabled: mintConfigs[addr]?.isEnabled || false,
      burnEnabled: burnConfigs[addr]?.isEnabled || false,
      maxBalance: mintConfigs[addr]?.maxBalance || "0",
      minReserve: burnConfigs[addr]?.minReserve || "0",
      mintFeeBps: mintConfigs[addr]?.feeBps || "0",
      burnFeeBps: burnConfigs[addr]?.feeBps || "0",
      // With no escrow, redeemable liquidity is simply the balance above minReserve.
      availableLiquidity: (() => {
        const psmBalance = toBigInt(psmBalances[addr]);
        const minReserve = toBigInt(burnConfigs[addr]?.minReserve);
        return psmBalance > minReserve ? (psmBalance - minReserve).toString() : "0";
      })(),
    })),
    userMintableBalance: userBalances[mintableToken] || "0",
  };
};

export const psmMint = async (
  accessToken: string,
  userAddress: string,
  {
    amount,
    againstToken,
    toSavings,
  }: { amount: string; againstToken: string; toSavings?: boolean }
): Promise<{ status: string; hash: string }> => {
  const psmAddress = getPsmAddress();

  const txs: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: againstToken,
      method: "approve",
      args: { spender: psmAddress, value: amount },
    },
    {
      contractName: extractContractName(DirectMintPSM),
      contractAddress: psmAddress,
      method: toSavings ? "mintAndSave" : "mint",
      args: { amount, againstToken },
    },
  ];

  const builtTx = await buildFunctionTx(txs, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const psmRedeem = async (
  accessToken: string,
  userAddress: string,
  { amount, redeemToken }: { amount: string; redeemToken: string }
): Promise<{ status: string; hash: string }> => {
  const psmAddress = getPsmAddress();

  const psmResponse = await cirrus.get(accessToken, `/${DirectMintPSM}`, {
    params: { address: `eq.${psmAddress}`, select: "mintableToken" },
  });
  const mintableToken = normalizeAddress(psmResponse.data?.[0]?.mintableToken);
  if (!mintableToken) throw new Error("Could not resolve PSM mintableToken");

  const txs: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: mintableToken,
      method: "approve",
      args: { spender: psmAddress, value: amount },
    },
    {
      contractName: extractContractName(DirectMintPSM),
      contractAddress: psmAddress,
      method: "redeem",
      args: { amount, redeemToken },
    },
  ];

  const builtTx = await buildFunctionTx(txs, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};
