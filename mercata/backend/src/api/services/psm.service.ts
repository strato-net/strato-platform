import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";

const { DirectMintPSM, Token } = constants;

const normalizeAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const parseEventAttributes = (attributes: unknown): Record<string, any> => {
  if (!attributes) return {};
  if (typeof attributes === "string") {
    try { return JSON.parse(attributes); } catch { return {}; }
  }
  if (typeof attributes === "object") return attributes as Record<string, any>;
  return {};
};

const getPsmAddress = (): string => {
  const addr = constants.directMintPsm;
  if (!addr) throw new Error("DirectMintPSM not configured for this network");
  return addr;
};

export interface BurnRequestInfo {
  id: string;
  amount: string;
  redeemToken: string;
  redeemTokenSymbol: string;
  requester: string;
  requestTime: string;
  availableAt: string;
  isAvailable: boolean;
}

export interface PsmInfo {
  address: string;
  mintableToken: string;
  mintableTokenSymbol: string;
  burnDelay: string;
  eligibleTokens: Array<{
    address: string;
    symbol: string;
    name: string;
    userBalance: string;
    psmBalance: string;
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
      select: "mintableToken,burnReqCounter,burnDelay",
    },
  });
  const psm = psmResponse.data?.[0] || {};
  const mintableToken = normalizeAddress(psm.mintableToken);
  const burnDelay = psm.burnDelay?.toString() || "0";

  // 2. Eligible tokens (mapping entries where value is true)
  const eligibleResponse = await cirrus.get(
    accessToken,
    `/${DirectMintPSM}-eligibleTokens`,
    {
      params: {
        address: `eq.${psmAddress}`,
        value: "eq.true",
        select: "key",
      },
    }
  );
  const eligibleAddresses: string[] = (eligibleResponse.data || []).map(
    (e: any) => normalizeAddress(e.key)
  );

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

  // 5. PSM balances for eligible tokens
  let psmBalances: Record<string, string> = {};
  if (eligibleAddresses.length > 0) {
    const psmBalResponse = await cirrus.get(
      accessToken,
      `/${Token}-_balances`,
      {
        params: {
          address: `in.(${eligibleAddresses.join(",")})`,
          key: `eq.${psmAddress}`,
          select: "address,value::text",
        },
      }
    );
    for (const b of psmBalResponse.data || []) {
      psmBalances[normalizeAddress(b.address)] = b.value || "0";
    }
  }

  // 6. Burn requests via events
  const [requestedRes, resolvedRes] = await Promise.all([
    cirrus.get(accessToken, "/event", {
      params: {
        address: `eq.${psmAddress}`,
        event_name: "eq.BurnRequested",
        select: "attributes",
        "attributes->>requester": `eq.${normalizedUser}`,
      },
    }),
    cirrus.get(accessToken, "/event", {
      params: {
        address: `eq.${psmAddress}`,
        event_name: "in.(BurnCompleted,BurnCancelled)",
        select: "attributes",
      },
    }),
  ]);

  const resolvedIds = new Set(
    (resolvedRes.data || []).map((e: any) => {
      const attrs = parseEventAttributes(e.attributes);
      return String(attrs.id);
    })
  );

  const currentTime = Math.floor(Date.now() / 1000);
  const burnDelayNum = parseInt(burnDelay) || 0;

  const burnRequests: BurnRequestInfo[] = (requestedRes.data || [])
    .map((e: any) => {
      const attrs = parseEventAttributes(e.attributes);
      const id = String(attrs.id);
      const requestTime = String(attrs.requestTime || "0");
      const availableAt = String(parseInt(requestTime) + burnDelayNum);
      const redeemAddr = normalizeAddress(attrs.redeemToken);
      return {
        id,
        amount: String(attrs.amount || "0"),
        redeemToken: redeemAddr,
        redeemTokenSymbol: tokenMeta[redeemAddr]?.symbol || redeemAddr,
        requester: normalizeAddress(attrs.requester),
        requestTime,
        availableAt,
        isAvailable: currentTime >= parseInt(availableAt),
      };
    })
    .filter((r: BurnRequestInfo) => !resolvedIds.has(r.id));

  burnRequests.sort(
    (a, b) => parseInt(b.requestTime) - parseInt(a.requestTime)
  );

  return {
    address: psmAddress,
    mintableToken,
    mintableTokenSymbol: tokenMeta[mintableToken]?.symbol || "USDST",
    burnDelay,
    eligibleTokens: eligibleAddresses.map((addr) => ({
      address: addr,
      symbol: tokenMeta[addr]?.symbol || "",
      name: tokenMeta[addr]?.name || "",
      userBalance: userBalances[addr] || "0",
      psmBalance: psmBalances[addr] || "0",
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

  const tx: FunctionInput = {
    contractName: extractContractName(DirectMintPSM),
    contractAddress: psmAddress,
    method: "requestBurn",
    args: { amount, redeemToken },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
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
