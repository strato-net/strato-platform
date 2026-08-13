import { strato, cirrus } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import JSONBig from "json-bigint";

const { DirectMintPSM, Token } = constants;
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
  burnDelay: string;
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
    burnDelay: toIntegerString(parsed.burnDelay ?? tuple[2]),
    feeBps: toIntegerString(parsed.feeBps ?? tuple[3]),
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

export interface BurnRequestInfo {
  id: string;
  amount: string;
  payoutAmount: string;
  redeemToken: string;
  redeemTokenSymbol: string;
  requester: string;
  requestTime: string;
  burnDelay: string;
  availableAt: string;
  isAvailable: boolean;
}

export interface PsmInfo {
  address: string;
  mintableToken: string;
  mintableTokenSymbol: string;
  mintPaused: boolean;
  burnPaused: boolean;
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
    burnDelay: string;
    mintFeeBps: string;
    burnFeeBps: string;
    pendingRedemptions: string;
    availableLiquidity: string;
  }>;
  burnRequests: BurnRequestInfo[];
  userMintableBalance: string;
}

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
      select: "mintableToken,mintPaused,burnPaused",
    },
  });
  const psm = psmResponse.data?.[0] || {};
  const mintableToken = normalizeAddress(psm.mintableToken);

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

  // 5. PSM balances and reserved redemption liquidity for eligible tokens
  let psmBalances: Record<string, string> = {};
  let pendingRedemptions: Record<string, string> = {};
  if (eligibleAddresses.length > 0) {
    const [psmBalResponse, pendingResponse] = await Promise.all([
      cirrus.get(accessToken, `/${Token}-_balances`, {
        params: {
          address: `in.(${eligibleAddresses.join(",")})`,
          key: `eq.${psmAddress}`,
          select: "address,value::text",
        },
      }),
      cirrus.get(accessToken, `/${DirectMintPSM}-pendingRedemptions`, {
        params: {
          address: `eq.${psmAddress}`,
          select: "key,value::text",
        },
      }),
    ]);
    for (const b of psmBalResponse.data || []) {
      psmBalances[normalizeAddress(b.address)] = b.value || "0";
    }
    for (const entry of pendingResponse.data || []) {
      pendingRedemptions[normalizeAddress(entry.key)] = toIntegerString(entry.value);
    }
  }

  // 6. Burn requests from the mapping table (zeroed entries = deleted)
  const burnReqResponse = await cirrus.get(
    accessToken,
    `/${DirectMintPSM}-burnRequests`,
    {
      params: {
        address: `eq.${psmAddress}`,
        select: "key,value::text",
      },
    }
  );

  const currentTime = Math.floor(Date.now() / 1000);

  const burnRequests: BurnRequestInfo[] = (burnReqResponse.data || [])
    .map((entry: any) => {
      const val = parseStructValue(entry.value);
      const tuple = parseTupleValue(entry.value);
      const amount = toIntegerString(val?.burnAmount ?? tuple[0]);
      const payoutAmount = toIntegerString(val?.payoutAmount ?? tuple[1]);
      const redeemAddr = normalizeAddress(val?.redeemToken ?? tuple[2]);
      const requester = normalizeAddress(val?.requester ?? tuple[3]);
      const requestTime = toIntegerString(val?.requestTime ?? tuple[4]);
      const burnDelay = burnConfigs[redeemAddr]?.burnDelay || "0";
      const availableAt = String((toBigInt(requestTime) + toBigInt(burnDelay)).toString());
      return {
        id: String(entry.key),
        amount,
        payoutAmount,
        redeemToken: redeemAddr,
        redeemTokenSymbol: tokenMeta[redeemAddr]?.symbol || redeemAddr,
        requester,
        requestTime,
        burnDelay,
        availableAt,
        isAvailable: currentTime >= parseInt(availableAt),
      };
    })
    .filter(
      (r: BurnRequestInfo) =>
        r.requester === normalizedUser && r.amount !== "0" && BigInt(r.amount) > 0n
    );

  burnRequests.sort(
    (a, b) => parseInt(b.requestTime) - parseInt(a.requestTime)
  );

  return {
    address: psmAddress,
    mintableToken,
    mintableTokenSymbol: tokenMeta[mintableToken]?.symbol || "USDST",
    mintPaused: toBoolean(psm.mintPaused),
    burnPaused: toBoolean(psm.burnPaused),
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
      burnDelay: burnConfigs[addr]?.burnDelay || "0",
      mintFeeBps: mintConfigs[addr]?.feeBps || "0",
      burnFeeBps: burnConfigs[addr]?.feeBps || "0",
      pendingRedemptions: pendingRedemptions[addr] || "0",
      availableLiquidity: (() => {
        const psmBalance = toBigInt(psmBalances[addr]);
        const pending = toBigInt(pendingRedemptions[addr]);
        const minReserve = toBigInt(burnConfigs[addr]?.minReserve);
        const unreserved = psmBalance - pending;
        return unreserved > minReserve ? (unreserved - minReserve).toString() : "0";
      })(),
    })),
    burnRequests,
    userMintableBalance: userBalances[mintableToken] || "0",
  };
};

export const psmMint = async (
  accessToken: string,
  userAddress: string,
  { amount, againstToken }: { amount: string; againstToken: string }
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
      method: "mint",
      args: { amount, againstToken },
    },
  ];

  const builtTx = await buildFunctionTx(txs, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const psmRequestBurn = async (
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
      method: "requestBurn",
      args: { amount, redeemToken },
    },
  ];

  const builtTx = await buildFunctionTx(txs, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const psmCompleteBurn = async (
  accessToken: string,
  userAddress: string,
  { id }: { id: string }
): Promise<{ status: string; hash: string }> => {
  const psmAddress = getPsmAddress();

  const tx: FunctionInput = {
    contractName: extractContractName(DirectMintPSM),
    contractAddress: psmAddress,
    method: "completeBurn",
    args: { id },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const psmCancelBurn = async (
  accessToken: string,
  userAddress: string,
  { id }: { id: string }
): Promise<{ status: string; hash: string }> => {
  const psmAddress = getPsmAddress();

  const tx: FunctionInput = {
    contractName: extractContractName(DirectMintPSM),
    contractAddress: psmAddress,
    method: "cancelBurn",
    args: { id },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};
