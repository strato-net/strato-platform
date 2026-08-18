import {
  RouteAction,
  RouteExecuteParams,
  RouteQuoteResponse,
  RouteStep,
  RouteStepQuote,
  TransactionResponse,
  TradeQuote,
} from "@strato/shared-types";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import { FunctionInput } from "../../types/types";
import { cirrus } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { executeTransaction } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import {
  buildTokenApprovalTx,
  fetchMultiTokenStablePools,
  fetchPoolCoins,
  fetchPoolTokenAddresses,
} from "../helpers/swapping.helper";
import { getConfigs } from "./metalForge.service";
import { getPoolTokenPairs } from "./poolV3.service";
import { getPsmMintState } from "./psm.service";
import { getSaveUsdstActionState } from "./saveUsdst.service";
import { getTradeQuotes, TRADE_DEADLINE_SECONDS } from "./trade.service";
import { getYieldVaultInfo, listVaultDefs } from "./yieldVault.service";

const BPS = 10_000n;
const WAD = 10n ** 18n;
const MAX_ROUTE_STEPS = 6;
const MAX_CANDIDATE_ROUTES = 12;
const MAX_SEARCH_STATES = 2_000;
const DEFAULT_SLIPPAGE_BPS = 50;

const normalizeAddress = (address: string): string => address.toLowerCase().replace(/^0x/, "");

type EdgeKind = "SWAP" | "PSM_MINT" | "FORGE" | "SAVE" | "YIELD_VAULT_DEPOSIT";

interface RouteEdge {
  kind: EdgeKind;
  tokenIn: string;
  tokenOut: string;
  target?: string;
  feeBps?: number;
  maxBalance?: string;
  mintCap?: string;
  totalMinted?: string;
  priceIn?: string;
  priceOut?: string;
  exchangeRate?: string;
}

interface GraphPoolRow {
  address: string;
  tokenA: { address: string; status: string };
  tokenB: { address: string; status: string };
  tokenABalance: string;
  tokenBBalance: string;
  isPaused: boolean;
  isDisabled: boolean;
}

interface GraphV3Row {
  address: string;
  token0: string;
  token1: string;
  token0Balance: string;
  token1Balance: string;
  isPaused: boolean;
  isDisabled: boolean;
}

export const applyRouteSlippage = (amount: bigint, slippageBps: number): bigint => {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= Number(BPS)) {
    throw new Error("slippageBps must be an integer between 0 and 9999");
  }
  return (amount * (BPS - BigInt(slippageBps))) / BPS;
};

const addDirectedPair = (edges: RouteEdge[], seen: Set<string>, tokenA: string, tokenB: string) => {
  const a = normalizeAddress(tokenA);
  const b = normalizeAddress(tokenB);
  if (!a || !b || a === b) return;
  for (const [tokenIn, tokenOut] of [[a, b], [b, a]]) {
    const key = `${tokenIn}:${tokenOut}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ kind: "SWAP", tokenIn, tokenOut });
    }
  }
};

const getSwapEdges = async (accessToken: string): Promise<RouteEdge[]> => {
  const [poolResponse, v3Response, multiPools] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Pool}`, {
      params: {
        poolFactory: `eq.${constants.poolFactory}`,
        isDisabled: "eq.false",
        select: [
          "address",
          "tokenA:tokenA_fkey(address,status)",
          "tokenB:tokenB_fkey(address,status)",
          "tokenABalance::text",
          "tokenBBalance::text",
          "isPaused",
          "isDisabled",
        ].join(","),
      },
    }),
    config.poolV3Factory
      ? cirrus.get(accessToken, "/BlockApps-PoolV3", {
          params: {
            poolV3Factory: `eq.${config.poolV3Factory}`,
            isDisabled: "eq.false",
            sqrtPriceX96: "neq.0",
            select: "address,token0,token1,token0Balance::text,token1Balance::text,isPaused,isDisabled",
          },
        })
      : Promise.resolve({ data: [] }),
    fetchMultiTokenStablePools(accessToken),
  ]);

  const edges: RouteEdge[] = [];
  const seen = new Set<string>();
  for (const row of (poolResponse.data || []) as GraphPoolRow[]) {
    if (
      row.isPaused ||
      row.isDisabled ||
      row.tokenA?.status !== "2" ||
      row.tokenB?.status !== "2" ||
      BigInt(row.tokenABalance || "0") <= 0n ||
      BigInt(row.tokenBBalance || "0") <= 0n ||
      config.hiddenSwapPools.has(row.address)
    ) continue;
    addDirectedPair(edges, seen, row.tokenA.address, row.tokenB.address);
  }

  for (const row of (v3Response.data || []) as GraphV3Row[]) {
    if (
      row.isPaused ||
      row.isDisabled ||
      BigInt(row.token0Balance || "0") <= 0n ||
      BigInt(row.token1Balance || "0") <= 0n ||
      config.hiddenSwapPools.has(row.address)
    ) continue;
    addDirectedPair(edges, seen, row.token0, row.token1);
  }

  for (const pool of multiPools) {
    if (pool.isPaused || pool.isDisabled || config.hiddenSwapPools.has(pool.address)) continue;
    const funded = pool.coins.filter(
      ({ tokenAddress }) =>
        BigInt(
          pool.tokenBalances.get(normalizeAddress(tokenAddress)) ||
          pool.tokenBalances.get(tokenAddress) ||
          "0"
        ) > 0n
    );
    for (let i = 0; i < funded.length; i++) {
      for (let j = i + 1; j < funded.length; j++) {
        addDirectedPair(edges, seen, funded[i].tokenAddress, funded[j].tokenAddress);
      }
    }
  }

  const tokenAddresses = [...new Set(edges.flatMap(({ tokenIn, tokenOut }) => [tokenIn, tokenOut]))];
  if (tokenAddresses.length === 0) return [];
  const { data: tokenRows } = await cirrus.get(accessToken, `/${constants.Token}`, {
    params: {
      address: `in.(${tokenAddresses.join(",")})`,
      select: "address,status",
    },
  });
  const activeTokens = new Set(
    (tokenRows || [])
      .filter(({ status }: { status: string }) => status === "2")
      .map(({ address }: { address: string }) => normalizeAddress(address))
  );
  return edges.filter(
    ({ tokenIn, tokenOut }) => activeTokens.has(tokenIn) && activeTokens.has(tokenOut)
  );
};

const getPsmEdges = async (accessToken: string): Promise<RouteEdge[]> => {
  if (!constants.directMintPsm) return [];
  const state = await getPsmMintState(accessToken);
  if (state.mintPaused || !state.mintableToken) return [];
  return [...state.mintConfigs.entries()]
    .filter(([, mintConfig]) => mintConfig.isEnabled)
    .map(([tokenIn, mintConfig]) => ({
      kind: "PSM_MINT" as const,
      tokenIn,
      tokenOut: state.mintableToken,
      target: normalizeAddress(constants.directMintPsm),
      feeBps: Number(mintConfig.feeBps),
      maxBalance: mintConfig.maxBalance,
    }));
};

const getForgeEdges = async (accessToken: string): Promise<RouteEdge[]> => {
  if (!constants.metalForge) return [];
  const { metals, payTokens } = await getConfigs(accessToken);
  return metals.flatMap((metal) =>
    metal.isEnabled
      ? payTokens.map((payToken) => ({
          kind: "FORGE" as const,
          tokenIn: normalizeAddress(payToken.address),
          tokenOut: normalizeAddress(metal.address),
          target: normalizeAddress(constants.metalForge),
          feeBps: Number(metal.feeBps),
          mintCap: metal.mintCap,
          totalMinted: metal.totalMinted,
          priceIn: payToken.price,
          priceOut: metal.price,
        }))
      : []
  );
};

const getSaveEdges = async (accessToken: string): Promise<RouteEdge[]> => {
  if (!constants.saveUsdstVault) return [];
  const state = await getSaveUsdstActionState(accessToken);
  if (!state || state.paused) return [];
  return [{
    kind: "SAVE",
    tokenIn: normalizeAddress(state.assetAddress),
    tokenOut: normalizeAddress(state.vaultAddress),
    target: normalizeAddress(state.vaultAddress),
    exchangeRate: state.projectedExchangeRate,
  }];
};

const getApprovedYieldVaults = async (accessToken: string): Promise<Set<string>> => {
  if (!constants.tokenRouter) return new Set();
  const { data } = await cirrus.get(accessToken, `/${constants.TokenRouter}-approvedYieldVaults`, {
    params: {
      address: `eq.${constants.tokenRouter}`,
      value: "eq.true",
      select: "key",
    },
  });
  return new Set((data || []).map((row: { key: string }) => normalizeAddress(row.key)));
};

const getYieldVaultEdges = async (accessToken: string): Promise<RouteEdge[]> => {
  const approved = await getApprovedYieldVaults(accessToken);
  if (approved.size === 0) return [];
  const definitions = listVaultDefs().filter(
    ({ address }) => address && approved.has(normalizeAddress(address))
  );
  const infos = await Promise.all(definitions.map(({ key }) => getYieldVaultInfo(accessToken, key)));
  return infos
    .filter((info) => info.deployed && !info.paused && info.assetAddress)
    .map((info) => ({
      kind: "YIELD_VAULT_DEPOSIT" as const,
      tokenIn: normalizeAddress(info.assetAddress),
      tokenOut: normalizeAddress(info.vaultAddress),
      target: normalizeAddress(info.vaultAddress),
      exchangeRate: info.projectedExchangeRate,
    }));
};

const safely = async (builder: () => Promise<RouteEdge[]>): Promise<RouteEdge[]> => {
  try {
    return await builder();
  } catch {
    return [];
  }
};

const buildRouteEdges = async (accessToken: string): Promise<RouteEdge[]> => {
  const groups = await Promise.all([
    getSwapEdges(accessToken),
    safely(() => getPsmEdges(accessToken)),
    safely(() => getForgeEdges(accessToken)),
    safely(() => getSaveEdges(accessToken)),
    safely(() => getYieldVaultEdges(accessToken)),
  ]);
  return groups.flat();
};

export const findRoutePaths = (
  edges: RouteEdge[],
  tokenIn: string,
  tokenOut: string
): RouteEdge[][] => {
  const start = normalizeAddress(tokenIn);
  const destination = normalizeAddress(tokenOut);
  const adjacency = new Map<string, RouteEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.tokenIn) || [];
    list.push(edge);
    adjacency.set(edge.tokenIn, list);
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => Number(b.tokenOut === destination) - Number(a.tokenOut === destination));
  }

  const queue: Array<{ token: string; path: RouteEdge[]; visited: Set<string> }> = [
    { token: start, path: [], visited: new Set([start]) },
  ];
  const routes: RouteEdge[][] = [];
  let searched = 0;
  while (queue.length > 0 && routes.length < MAX_CANDIDATE_ROUTES && searched < MAX_SEARCH_STATES) {
    const current = queue.shift()!;
    searched++;
    if (current.path.length >= MAX_ROUTE_STEPS) continue;
    for (const edge of adjacency.get(current.token) || []) {
      if (current.visited.has(edge.tokenOut)) continue;
      const path = [...current.path, edge];
      if (edge.tokenOut === destination) {
        routes.push(path);
        if (routes.length >= MAX_CANDIDATE_ROUTES) break;
      } else {
        queue.push({
          token: edge.tokenOut,
          path,
          visited: new Set([...current.visited, edge.tokenOut]),
        });
      }
    }
  }
  return routes;
};

const getPsmBalance = async (
  accessToken: string,
  tokenAddress: string,
  psmAddress: string
): Promise<bigint> => {
  const { data } = await cirrus.get(accessToken, `/${constants.Token}-_balances`, {
    params: {
      address: `eq.${tokenAddress}`,
      key: `eq.${psmAddress}`,
      select: "value::text",
      limit: "1",
    },
  });
  return BigInt(data?.[0]?.value || "0");
};

export const fetchFactoryPoolIndex = async (accessToken: string, poolAddress: string): Promise<string> => {
  const target = normalizeAddress(poolAddress);
  const { data } = await cirrus.get(accessToken, `/${constants.PoolFactory}-allPools`, {
    params: {
      address: `eq.${constants.poolFactory}`,
      value: `eq.${target}`,
      select: "key,value",
      limit: "1",
    },
  });
  const row = data?.[0];
  if (row?.key === undefined || row?.key === null) {
    throw new Error("Stable pool factory index could not be resolved");
  }
  return String(row.key);
};

const buildSwapStep = async (
  accessToken: string,
  quote: TradeQuote,
  slippageBps: number
): Promise<RouteStepQuote> => {
  const minAmountOut = applyRouteSlippage(BigInt(quote.amountOut), slippageBps);
  if (minAmountOut <= 0n) throw new Error("Route step output is below the slippage minimum");

  let action: RouteAction;
  let parameter1 = "0";
  let parameter2 = "0";
  let factoryPoolIndex = "0";
  let direction = false;
  if (quote.poolType === "stable") {
    action = RouteAction.SWAP_STABLE;
    const coins = await fetchPoolCoins(accessToken, quote.poolAddress);
    const i = coins.find(({ tokenAddress }) => normalizeAddress(tokenAddress) === quote.tokenIn)?.coinIndex;
    const j = coins.find(({ tokenAddress }) => normalizeAddress(tokenAddress) === quote.tokenOut)?.coinIndex;
    if (i === undefined || j === undefined) throw new Error("Stable pool coin indices could not be resolved");
    parameter1 = String(i);
    parameter2 = String(j);
    if (coins.length > 2) {
      factoryPoolIndex = await fetchFactoryPoolIndex(accessToken, quote.poolAddress);
    }
  } else if (quote.poolType === "v3") {
    action = RouteAction.SWAP_V3;
    const pair = (await getPoolTokenPairs(accessToken, [quote.poolAddress])).get(normalizeAddress(quote.poolAddress));
    if (!pair) throw new Error("V3 pool pair could not be resolved");
    direction = pair.token0 === normalizeAddress(quote.tokenIn);
  } else {
    action = RouteAction.SWAP_V2;
    const pair = await fetchPoolTokenAddresses(accessToken, quote.poolAddress);
    if (!pair) throw new Error("V2 pool pair could not be resolved");
    direction = pair.tokenA === normalizeAddress(quote.tokenIn);
  }

  return {
    action,
    target: normalizeAddress(quote.poolAddress),
    tokenIn: normalizeAddress(quote.tokenIn),
    tokenOut: normalizeAddress(quote.tokenOut),
    minAmountOut: minAmountOut.toString(),
    parameter1,
    parameter2,
    direction,
    factoryPoolIndex,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    feeAmount: quote.feeAmount,
    feeBps: quote.feeBps,
    priceImpact: quote.priceImpact,
    label: quote.poolLabel,
  };
};

const quoteEdge = async (
  accessToken: string,
  edge: RouteEdge,
  amountIn: bigint,
  slippageBps: number
): Promise<RouteStepQuote> => {
  if (edge.kind === "SWAP") {
    const response = await getTradeQuotes(
      accessToken,
      edge.tokenIn,
      edge.tokenOut,
      amountIn,
      "EXACT_INPUT"
    );
    const quote = response.quotes.find(({ poolAddress }) => poolAddress === response.bestPoolAddress);
    if (!quote) throw new Error(`No executable pool for ${edge.tokenIn} -> ${edge.tokenOut}`);
    if (quote.partialFill) throw new Error("V3 route step cannot consume the full input amount");
    return buildSwapStep(accessToken, quote, slippageBps);
  }

  let amountOut = 0n;
  let feeAmount = 0n;
  let action: RouteAction;
  let label: string;
  if (edge.kind === "PSM_MINT") {
    action = RouteAction.PSM_MINT;
    label = "PSM Mint";
    feeAmount = (amountIn * BigInt(edge.feeBps || 0)) / BPS;
    amountOut = amountIn - feeAmount;
    const maxBalance = BigInt(edge.maxBalance || "0");
    if (maxBalance > 0n) {
      const balance = await getPsmBalance(accessToken, edge.tokenIn, edge.target!);
      if (balance + amountIn > maxBalance) throw new Error("PSM token balance cap exceeded");
    }
  } else if (edge.kind === "FORGE") {
    action = RouteAction.FORGE;
    label = "Metal Forge";
    feeAmount = (amountIn * BigInt(edge.feeBps || 0)) / BPS;
    const principal = amountIn - feeAmount;
    const priceIn = edge.tokenIn === normalizeAddress(constants.USDST)
      ? WAD
      : BigInt(edge.priceIn || "0");
    const priceOut = BigInt(edge.priceOut || "0");
    if (priceIn <= 0n || priceOut <= 0n) throw new Error("Forge oracle price is unavailable");
    amountOut = (principal * priceIn) / priceOut;
    if (BigInt(edge.totalMinted || "0") + amountOut > BigInt(edge.mintCap || "0")) {
      throw new Error("Metal forge mint cap exceeded");
    }
  } else {
    action = edge.kind === "SAVE" ? RouteAction.SAVE : RouteAction.YIELD_VAULT_DEPOSIT;
    label = edge.kind === "SAVE" ? "Save USDST" : "Yield Vault";
    const exchangeRate = BigInt(edge.exchangeRate || "0");
    if (exchangeRate <= 0n) throw new Error("Vault exchange rate is unavailable");
    amountOut = (amountIn * WAD) / exchangeRate;
  }

  const minAmountOut = applyRouteSlippage(amountOut, slippageBps);
  if (amountOut <= 0n || minAmountOut <= 0n) throw new Error(`${label} output is zero`);
  return {
    action,
    target: edge.target!,
    tokenIn: edge.tokenIn,
    tokenOut: edge.tokenOut,
    minAmountOut: minAmountOut.toString(),
    parameter1: "0",
    parameter2: "0",
    direction: false,
    factoryPoolIndex: "0",
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    feeAmount: feeAmount.toString(),
    feeBps: edge.feeBps || 0,
    priceImpact: 0,
    label,
  };
};

const quotePath = async (
  accessToken: string,
  path: RouteEdge[],
  amountIn: bigint,
  slippageBps: number
): Promise<RouteStepQuote[]> => {
  const steps: RouteStepQuote[] = [];
  let currentAmount = amountIn;
  for (const edge of path) {
    const step = await quoteEdge(accessToken, edge, currentAmount, slippageBps);
    steps.push(step);
    currentAmount = BigInt(step.amountOut);
  }
  return steps;
};

export const getRouteQuote = async (
  accessToken: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  slippageBps = DEFAULT_SLIPPAGE_BPS
): Promise<RouteQuoteResponse> => {
  const input = normalizeAddress(tokenIn);
  const output = normalizeAddress(tokenOut);
  if (input === output) throw new Error("Cannot route a token to itself");
  if (amountIn <= 0n) throw new Error("Amount must be greater than 0");
  applyRouteSlippage(amountIn, slippageBps);

  const paths = findRoutePaths(await buildRouteEdges(accessToken), input, output);
  if (paths.length === 0) throw new Error(`No route found for ${input} -> ${output}`);

  const quoted = await Promise.all(
    paths.map((path) => quotePath(accessToken, path, amountIn, slippageBps).catch(() => null))
  );
  const best = quoted
    .filter((steps): steps is RouteStepQuote[] => Boolean(steps?.length))
    .reduce<RouteStepQuote[] | null>((current, steps) => {
      if (!current) return steps;
      return BigInt(steps[steps.length - 1].amountOut) >
        BigInt(current[current.length - 1].amountOut)
        ? steps
        : current;
    }, null);
  if (!best) throw new Error(`No executable route found for ${input} -> ${output}`);

  const amountOut = BigInt(best[best.length - 1].amountOut);
  const minFinalOut = applyRouteSlippage(amountOut, slippageBps);
  if (minFinalOut <= 0n) throw new Error("Final route output is below the slippage minimum");
  return {
    tokenIn: input,
    tokenOut: output,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    minFinalOut: minFinalOut.toString(),
    slippageBps,
    deadline: Math.floor(Date.now() / 1000) + TRADE_DEADLINE_SECONDS,
    steps: best,
  };
};

export const toExecutableRouteStep = ({
  action,
  target,
  tokenIn,
  tokenOut,
  minAmountOut,
  parameter1,
  parameter2,
  direction,
  factoryPoolIndex,
}: RouteStepQuote): RouteStep => ({
  action,
  target,
  tokenIn,
  tokenOut,
  minAmountOut,
  parameter1,
  parameter2,
  direction,
  factoryPoolIndex,
});

export const executeRoute = async (
  accessToken: string,
  params: RouteExecuteParams,
  userAddress: string
): Promise<TransactionResponse> => {
  if (!constants.tokenRouter) throw new Error("TOKEN_ROUTER is not configured for this network");
  const amountIn = BigInt(params.amountIn);
  const requestedMinimum = BigInt(params.minFinalOut);
  if (requestedMinimum <= 0n) throw new Error("minFinalOut must be greater than 0");
  const quote = await getRouteQuote(
    accessToken,
    params.tokenIn,
    params.tokenOut,
    amountIn,
    params.slippageBps ?? DEFAULT_SLIPPAGE_BPS
  );
  if (BigInt(quote.amountOut) < requestedMinimum) {
    throw new Error("Current route output is below minFinalOut");
  }

  const recipient = normalizeAddress(params.recipient || userAddress);
  if (!recipient || recipient === constants.ZERO_ADDRESS || recipient === normalizeAddress(constants.tokenRouter)) {
    throw new Error("Invalid route recipient");
  }
  const steps = quote.steps.map(toExecutableRouteStep);

  const transactions: FunctionInput[] = [
    buildTokenApprovalTx(normalizeAddress(params.tokenIn), normalizeAddress(constants.tokenRouter), params.amountIn),
    {
      contractName: extractContractName(constants.TokenRouter),
      contractAddress: normalizeAddress(constants.tokenRouter),
      method: "executeRoute",
      args: {
        tokenIn: normalizeAddress(params.tokenIn),
        expectedTokenOut: normalizeAddress(params.tokenOut),
        amountIn: params.amountIn,
        recipient,
        steps,
        deadline: quote.deadline,
        minFinalOut: params.minFinalOut,
      },
    },
  ];
  return executeTransaction(
    accessToken,
    await buildFunctionTx(transactions, userAddress, accessToken)
  );
};
