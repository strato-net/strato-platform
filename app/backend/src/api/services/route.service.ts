import {
  RouteAction,
  RouteExecuteParams,
  RouteQuoteResponse,
  RouteStepQuote,
  SwapToken,
  TransactionResponse,
  TradeQuote,
} from "@strato/shared-types";
import { constants, ROUTE_TOPOLOGY_TTL_MS, ROUTE_OUTPUT_TOLERANCE_BPS, ROUTE_CANDIDATES_PER_HOP, ROUTE_QUOTE_CONCURRENCY, MAX_UINT256 } from "../../config/constants";
import * as config from "../../config/config";
import { FunctionInput, RouteEdge, RouteQuoteRejection, RouteStepCandidate, RouteTopologyCache, StratoRouteStep } from "../../types/types";
import { cirrus } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { executeTransaction } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoError } from "../../errors";
import {
  buildTokenApprovalTx,
  fetchMultiTokenStablePools,
  fetchPoolCoins,
  fetchPoolTokenAddresses,
} from "../helpers/swapping.helper";
import { getVaultSharePrice, previewVaultDeposit } from "../helpers/vault.helper";
import { getOraclePrices } from "./oracle.service";
import { getConfigs } from "./metalForge.service";
import { getPoolTokenPairs } from "./poolV3.service";
import { getPsmMintState } from "./psm.service";
import { getSaveUsdstActionState } from "./saveUsdst.service";
import { getTradeQuotes, TRADE_DEADLINE_SECONDS } from "./trade.service";
import { getYieldVaultActionState, listVaultDefs } from "./yieldVault.service";

const BPS = 10_000n;
const WAD = 10n ** 18n;
const MAX_ROUTE_STEPS = 6;
const MAX_SEARCH_STATES = 2_000;
const DEFAULT_SLIPPAGE_BPS = 50;

const normalizeAddress = (address: string): string =>
  address.toLowerCase().replace(/^0x/, "");

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

export const applyRouteSlippage = (
  amount: bigint,
  slippageBps: number
): bigint => {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 1 ||
    slippageBps >= Number(BPS)
  ) {
    throw new Error("slippageBps must be an integer between 1 and 9999");
  }
  return (amount * (BPS - BigInt(slippageBps))) / BPS;
};

const addDirectedPair = (
  edges: RouteEdge[],
  seen: Set<string>,
  tokenA: string,
  tokenB: string
) => {
  const a = normalizeAddress(tokenA);
  const b = normalizeAddress(tokenB);
  if (!a || !b || a === b) return;
  for (const [tokenIn, tokenOut] of [
    [a, b],
    [b, a],
  ]) {
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
            select:
              "address,token0,token1,token0Balance::text,token1Balance::text,isPaused,isDisabled",
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
    ) {
      continue;
    }
    addDirectedPair(edges, seen, row.tokenA.address, row.tokenB.address);
  }

  for (const row of (v3Response.data || []) as GraphV3Row[]) {
    if (
      row.isPaused ||
      row.isDisabled ||
      BigInt(row.token0Balance || "0") <= 0n ||
      BigInt(row.token1Balance || "0") <= 0n ||
      config.hiddenSwapPools.has(row.address)
    ) {
      continue;
    }
    addDirectedPair(edges, seen, row.token0, row.token1);
  }

  for (const pool of multiPools) {
    if (
      pool.isPaused ||
      pool.isDisabled ||
      config.hiddenSwapPools.has(pool.address)
    ) {
      continue;
    }
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
        addDirectedPair(
          edges,
          seen,
          funded[i].tokenAddress,
          funded[j].tokenAddress
        );
      }
    }
  }

  const tokenAddresses = [
    ...new Set(edges.flatMap(({ tokenIn, tokenOut }) => [tokenIn, tokenOut])),
  ];
  if (tokenAddresses.length === 0) return [];
  const { data: tokenRows } = await cirrus.get(
    accessToken,
    `/${constants.Token}`,
    {
      params: {
        address: `in.(${tokenAddresses.join(",")})`,
        select: "address,status",
      },
    }
  );
  const activeTokens = new Set(
    (tokenRows || [])
      .filter(({ status }: { status: string }) => status === "2")
      .map(({ address }: { address: string }) => normalizeAddress(address))
  );
  return edges.filter(
    ({ tokenIn, tokenOut }) =>
      activeTokens.has(tokenIn) && activeTokens.has(tokenOut)
  );
};

let swapTopologyCache: RouteTopologyCache | undefined;

const getCachedSwapEdges = (accessToken: string): Promise<RouteEdge[]> => {
  const key = JSON.stringify([
    config.nodeUrl, config.networkId, constants.poolFactory,
    config.poolV3Factory, [...config.hiddenSwapPools].sort(),
  ]);
  if (swapTopologyCache?.key === key && swapTopologyCache.expiresAt > Date.now()) {
    return swapTopologyCache.edges;
  }
  const entry: RouteTopologyCache = {
    key,
    expiresAt: Date.now() + ROUTE_TOPOLOGY_TTL_MS,
    edges: getSwapEdges(accessToken),
  };
  swapTopologyCache = entry;
  entry.edges.catch(() => {
    if (swapTopologyCache === entry) swapTopologyCache = undefined;
  });
  return entry.edges;
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
          outputName: metal.name,
          outputSymbol: metal.symbol,
          outputDecimals: 18,
        }))
      : []
  );
};

const getSaveEdges = async (accessToken: string): Promise<RouteEdge[]> => {
  if (!constants.saveUsdstVault) return [];
  const state = await getSaveUsdstActionState(accessToken);
  if (!state || state.paused || BigInt(state.maxDeposit) === 0n) return [];
  return [
    {
      kind: "SAVE",
      tokenIn: normalizeAddress(state.assetAddress),
      tokenOut: normalizeAddress(state.vaultAddress),
      target: normalizeAddress(state.vaultAddress),
      vaultDeposit: { totalShares: state.totalShares, pricingAssets: state.pricingAssets, maxDeposit: state.maxDeposit },
      outputName: "Save USDST",
      outputSymbol: state.shareSymbol,
      outputDecimals: 18,
    },
  ];
};

const getApprovedYieldVaults = async (
  accessToken: string
): Promise<Set<string>> => {
  if (!constants.tokenRouter) return new Set();
  const { data } = await cirrus.get(
    accessToken,
    `/${constants.TokenRouter}-approvedYieldVaults`,
    {
      params: {
        address: `eq.${constants.tokenRouter}`,
        value: "eq.true",
        select: "key",
      },
    }
  );
  return new Set(
    (data || []).map((row: { key: string }) => normalizeAddress(row.key))
  );
};

const getYieldVaultEdges = async (
  accessToken: string
): Promise<RouteEdge[]> => {
  const approved = await getApprovedYieldVaults(accessToken);
  if (approved.size === 0) return [];
  const definitions = listVaultDefs().filter(
    ({ address }) => address && approved.has(normalizeAddress(address))
  );
  const infos = await Promise.all(
    definitions.map(({ key }) => getYieldVaultActionState(key))
  );
  return infos
    .filter((info): info is NonNullable<typeof info> => info !== null && !info.paused)
    .map((info) => ({
      kind: "YIELD_VAULT_DEPOSIT" as const,
      tokenIn: normalizeAddress(info.assetAddress),
      tokenOut: normalizeAddress(info.vaultAddress),
      target: normalizeAddress(info.vaultAddress),
      vaultDeposit: { totalShares: info.totalShares, pricingAssets: info.projectedActiveAssets, maxDeposit: MAX_UINT256.toString() },
      outputName: info.name,
      outputSymbol: info.shareSymbol,
      outputDecimals: info.decimals,
    }));
};

const safely = async (
  builder: () => Promise<RouteEdge[]>
): Promise<RouteEdge[]> => {
  try {
    return await builder();
  } catch {
    return [];
  }
};

const buildRouteEdges = async (
  accessToken: string
): Promise<RouteEdge[]> => {
  const groups = await Promise.all([
    getCachedSwapEdges(accessToken),
    safely(() => getPsmEdges(accessToken)),
    safely(() => getForgeEdges(accessToken)),
    safely(() => getSaveEdges(accessToken)),
    safely(() => getYieldVaultEdges(accessToken)),
  ]);
  return groups.flat();
};

export const getRouteAssets = async (
  accessToken: string,
  userAddress?: string
): Promise<SwapToken[]> => {
  const edges = await buildRouteEdges(accessToken);
  const addresses = [
    ...new Set(edges.flatMap(({ tokenIn, tokenOut }) => [tokenIn, tokenOut])),
  ];
  const sourceAddresses = new Set(edges.map(({ tokenIn }) => tokenIn));
  if (addresses.length === 0) return [];

  const [{ data }, oraclePrices] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Token}`, {
      params: {
        address: `in.(${addresses.join(",")})`,
        status: "eq.2",
        select: [
          "address",
          "_name",
          "_symbol",
          "_totalSupply::text",
          "customDecimals",
          `images:${constants.Token}-images(value)`,
          ...(userAddress ? [`balances:${constants.Token}-_balances(user:key,balance:value::text)`] : []),
        ].join(","),
        ...(userAddress ? { "balances.key": `eq.${userAddress}` } : {}),
      },
    }),
    getOraclePrices(accessToken).catch(() => new Map<string, string>()),
  ]);
  const prices = new Map([...oraclePrices].map(([address, price]) => [normalizeAddress(address), price]));
  const assets = new Map<string, SwapToken>(
    (data || []).map((token: any) => [
      normalizeAddress(token.address),
      {
        ...token,
        address: normalizeAddress(token.address),
        balance: token.balances?.[0]?.balance || "0",
        price: prices.get(normalizeAddress(token.address)) || "0",
        poolBalance: "0",
        images: token.images || [],
        routableSource: sourceAddresses.has(normalizeAddress(token.address)),
      },
    ])
  );
  for (const edge of edges) {
    if (!edge.outputSymbol) continue;
    const price = edge.vaultDeposit
      ? getVaultSharePrice(prices.get(edge.tokenIn) || "0", edge.vaultDeposit)
      : prices.get(edge.tokenOut) || edge.priceOut || "0";
    const existing = assets.get(edge.tokenOut);
    const routeDestination = edge.kind === "SAVE" ? "savings" : edge.kind === "YIELD_VAULT_DEPOSIT" ? "vault" : "token";
    if (existing) {
      existing.price = price;
      if (routeDestination !== "token") existing.routeDestination = routeDestination;
      continue;
    }
    assets.set(edge.tokenOut, {
      address: edge.tokenOut,
      _name: edge.outputName || edge.outputSymbol,
      _symbol: edge.outputSymbol,
      customDecimals: edge.outputDecimals ?? 18,
      _totalSupply: "0",
      balance: "0",
      price,
      poolBalance: "0",
      images: [],
      routableSource: sourceAddresses.has(edge.tokenOut),
      routeDestination,
    });
  }
  return [...assets.values()].sort((a, b) =>
    a._symbol.localeCompare(b._symbol)
  );
};

export const getRoutePoolTokens = async (
  accessToken: string,
  poolAddress: string
): Promise<string[]> => {
  const address = normalizeAddress(poolAddress);
  if (config.hiddenSwapPools.has(address)) return [];
  const [coins, pair, v3Pairs] = await Promise.all([
    fetchPoolCoins(accessToken, address),
    fetchPoolTokenAddresses(accessToken, address),
    getPoolTokenPairs(accessToken, [address]),
  ]);
  if (coins.length >= 2) return coins.map(({ tokenAddress }) => normalizeAddress(tokenAddress));
  if (pair) return [pair.tokenA, pair.tokenB].map(normalizeAddress);
  const v3 = v3Pairs.get(address);
  return v3 ? [v3.token0, v3.token1].map(normalizeAddress) : [];
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
    list.sort(
      (a, b) =>
        Number(b.tokenOut === destination) -
        Number(a.tokenOut === destination)
    );
  }

  const queue: Array<{
    token: string;
    path: RouteEdge[];
    visited: Set<string>;
  }> = [{ token: start, path: [], visited: new Set([start]) }];
  const routes: RouteEdge[][] = [];
  const countsByHop = new Map<number, number>();
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const edge of adjacency.get(current.token) || []) {
      if (current.visited.has(edge.tokenOut)) continue;
      const path = [...current.path, edge];
      if (edge.tokenOut === destination) {
        const count = countsByHop.get(path.length) || 0;
        if (count < ROUTE_CANDIDATES_PER_HOP) {
          routes.push(path);
          countsByHop.set(path.length, count + 1);
        }
      } else if (path.length < MAX_ROUTE_STEPS && queue.length < MAX_SEARCH_STATES) {
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
  const { data } = await cirrus.get(
    accessToken,
    `/${constants.Token}-_balances`,
    {
      params: {
        address: `eq.${tokenAddress}`,
        key: `eq.${psmAddress}`,
        select: "value::text",
        limit: "1",
      },
    }
  );
  return BigInt(data?.[0]?.value || "0");
};

export const fetchFactoryPoolIndex = async (
  accessToken: string,
  poolAddress: string
): Promise<string> => {
  const target = normalizeAddress(poolAddress);
  const { data } = await cirrus.get(
    accessToken,
    `/${constants.PoolFactory}-allPools`,
    {
      params: {
        address: `eq.${constants.poolFactory}`,
        value: `eq.${JSON.stringify(target)}`,
        select: "key,value",
        limit: "1",
      },
    }
  );
  const row = data?.[0];
  if (row?.key === undefined || row?.key === null) {
    throw new Error("Pool factory index could not be resolved");
  }
  return String(row.key);
};

const buildSwapStep = async (
  accessToken: string,
  quote: TradeQuote,
  slippageBps: number
): Promise<RouteStepQuote> => {
  const minAmountOut = applyRouteSlippage(
    BigInt(quote.amountOut),
    slippageBps
  );
  if (minAmountOut <= 0n) {
    throw new Error("Route step output is below the slippage minimum");
  }

  let action: RouteAction;
  let parameter1 = "0";
  let parameter2 = "0";
  let factoryPoolIndex = "0";
  let direction = false;
  if (quote.poolType === "stable") {
    action = RouteAction.SWAP_STABLE;
    const [coins, poolIndex] = await Promise.all([
      fetchPoolCoins(accessToken, quote.poolAddress),
      fetchFactoryPoolIndex(accessToken, quote.poolAddress),
    ]);
    const i = coins.find(
      ({ tokenAddress }) =>
        normalizeAddress(tokenAddress) === normalizeAddress(quote.tokenIn)
    )?.coinIndex;
    const j = coins.find(
      ({ tokenAddress }) =>
        normalizeAddress(tokenAddress) === normalizeAddress(quote.tokenOut)
    )?.coinIndex;
    if (i === undefined || j === undefined) {
      throw new Error("Stable pool coin indices could not be resolved");
    }
    parameter1 = String(i);
    parameter2 = String(j);
    factoryPoolIndex = poolIndex;
  } else if (quote.poolType === "v3") {
    action = RouteAction.SWAP_V3;
    const pair = (
      await getPoolTokenPairs(accessToken, [quote.poolAddress])
    ).get(normalizeAddress(quote.poolAddress));
    if (!pair) throw new Error("V3 pool pair could not be resolved");
    direction =
      pair.token0 === normalizeAddress(quote.tokenIn);
  } else {
    action = RouteAction.SWAP_V2;
    const [pair, poolIndex] = await Promise.all([
      fetchPoolTokenAddresses(accessToken, quote.poolAddress),
      fetchFactoryPoolIndex(accessToken, quote.poolAddress),
    ]);
    if (!pair) throw new Error("V2 pool pair could not be resolved");
    factoryPoolIndex = poolIndex;
    direction =
      normalizeAddress(pair.tokenA) === normalizeAddress(quote.tokenIn);
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
      const balance = await getPsmBalance(
        accessToken,
        edge.tokenIn,
        edge.target!
      );
      if (balance + amountIn > maxBalance) {
        throw new Error("PSM token balance cap exceeded");
      }
    }
  } else if (edge.kind === "FORGE") {
    action = RouteAction.FORGE;
    label = "Metal Forge";
    feeAmount = (amountIn * BigInt(edge.feeBps || 0)) / BPS;
    const principal = amountIn - feeAmount;
    const priceIn =
      edge.tokenIn === normalizeAddress(constants.USDST)
        ? WAD
        : BigInt(edge.priceIn || "0");
    const priceOut = BigInt(edge.priceOut || "0");
    if (priceIn <= 0n || priceOut <= 0n) {
      throw new Error("Forge oracle price is unavailable");
    }
    const fundsUSD = (principal * priceIn) / WAD;
    amountOut = (fundsUSD * WAD) / priceOut;
    if (
      BigInt(edge.totalMinted || "0") + amountOut >
      BigInt(edge.mintCap || "0")
    ) {
      throw new Error("Metal forge mint cap exceeded");
    }
  } else {
    action =
      edge.kind === "SAVE"
        ? RouteAction.SAVE
        : RouteAction.YIELD_VAULT_DEPOSIT;
    label = edge.kind === "SAVE" ? "Save USDST" : "Yield Vault";
    if (!edge.vaultDeposit) throw new Error("Vault deposit state is unavailable");
    amountOut = previewVaultDeposit(amountIn, edge.vaultDeposit);
  }

  const minAmountOut = applyRouteSlippage(amountOut, slippageBps);
  if (amountOut <= 0n || minAmountOut <= 0n) {
    throw new Error(`${label} output is zero`);
  }
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

const routeRejectionReason = (error: unknown): RouteQuoteRejection["reason"] => {
  const message = error instanceof Error ? error.message : String(error);
  if (/partial|full input/i.test(message)) return "PARTIAL_FILL";
  if (/insufficient liquidity/i.test(message)) return "INSUFFICIENT_LIQUIDITY";
  if (/cap exceeded|exceeds executable limits|overflows uint256/i.test(message)) return "CAPACITY_LIMIT";
  if (/output is zero|zero shares|below the slippage minimum/i.test(message)) return "AMOUNT_TOO_SMALL";
  if (/paused|disabled/i.test(message)) return "POOL_UNAVAILABLE";
  if (/No executable pool/i.test(message)) return "NO_POOL";
  return "QUOTE_UNAVAILABLE";
};

const quotePath = async (
  accessToken: string,
  path: RouteEdge[],
  amountIn: bigint,
  slippageBps: number,
  quotes: Map<RouteEdge, Map<bigint, Promise<RouteStepCandidate[]>>>,
  rejections: RouteQuoteRejection[]
): Promise<RouteStepQuote[]> => {
  const steps: RouteStepQuote[] = [];
  const usedPools = new Set<string>();
  let currentAmount = amountIn;
  for (const edge of path) {
    const reject = (reason: RouteQuoteRejection["reason"], pool?: string) => {
      rejections.push({ tokenIn: edge.tokenIn, tokenOut: edge.tokenOut, pool, reason });
    };
    let edgeQuotes = quotes.get(edge);
    if (!edgeQuotes) {
      edgeQuotes = new Map();
      quotes.set(edge, edgeQuotes);
    }
    let pending = edgeQuotes.get(currentAmount);
    if (!pending) {
      const input = currentAmount;
      pending = (async (): Promise<RouteStepCandidate[]> => {
        if (edge.kind !== "SWAP") {
          let step: Promise<RouteStepQuote> | undefined;
          return [{ getStep: () => step ??= quoteEdge(accessToken, edge, input, slippageBps) }];
        }
        const response = await getTradeQuotes(accessToken, edge.tokenIn, edge.tokenOut, input, "EXACT_INPUT");
        const candidates = response.quotes.filter((quote) => {
          if (quote.error) reject(routeRejectionReason(new Error(quote.error)), quote.poolAddress);
          else if (quote.partialFill || BigInt(quote.amountIn) !== input) reject("PARTIAL_FILL", quote.poolAddress);
          else if (BigInt(quote.amountOut) <= 0n) reject("INSUFFICIENT_LIQUIDITY", quote.poolAddress);
          else return true;
          return false;
        });
        candidates.sort((a, b) => BigInt(a.amountOut) > BigInt(b.amountOut) ? -1 : BigInt(a.amountOut) < BigInt(b.amountOut) ? 1 : 0);
        if (!response.quotes.length) reject("NO_POOL");
        return candidates.map((quote) => {
          let step: Promise<RouteStepQuote> | undefined;
          return {
            pool: normalizeAddress(quote.poolAddress),
            getStep: () => step ??= buildSwapStep(accessToken, quote, slippageBps),
          };
        });
      })();
      edgeQuotes.set(input, pending);
    }
    let candidates: RouteStepCandidate[];
    try {
      candidates = await pending;
    } catch (error) {
      reject(routeRejectionReason(error));
      return [];
    }
    let step: RouteStepQuote | undefined;
    for (const candidate of candidates) {
      // Independent hop quotes do not reflect earlier swaps in the same pool.
      if (candidate.pool && usedPools.has(candidate.pool)) {
        reject("POOL_REUSE", candidate.pool);
        continue;
      }
      try {
        step = await candidate.getStep();
        break;
      } catch (error) {
        reject(routeRejectionReason(error), candidate.pool);
      }
    }
    if (!step) return [];
    if (edge.kind === "SWAP") usedPools.add(normalizeAddress(step.target));
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

  const paths = findRoutePaths(
    await buildRouteEdges(accessToken),
    input,
    output
  );
  if (paths.length === 0) {
    throw new StratoError(`No route found for ${input} -> ${output}`, 422);
  }

  const quotes = new Map<RouteEdge, Map<bigint, Promise<RouteStepCandidate[]>>>();
  const rejections: RouteQuoteRejection[] = [];
  const quoted: RouteStepQuote[][] = new Array(paths.length);
  let nextPath = 0;
  await Promise.all(Array.from({ length: Math.min(paths.length, ROUTE_QUOTE_CONCURRENCY) }, async () => {
    while (nextPath < paths.length) {
      const index = nextPath++;
      quoted[index] = await quotePath(accessToken, paths[index], amountIn, slippageBps, quotes, rejections);
    }
  }));
  const executable = quoted.filter(
    (steps): steps is RouteStepQuote[] => Boolean(steps?.length)
  );
  const bestOutput = executable.reduce((highest, steps) => {
    const output = BigInt(steps[steps.length - 1].amountOut);
    return output > highest ? output : highest;
  }, 0n);
  const best = executable
    .reduce<RouteStepQuote[] | null>((current, steps) => {
      // Compare against the global best without rounding the tolerance boundary.
      if (BigInt(steps[steps.length - 1].amountOut) * BPS <
          bestOutput * (BPS - ROUTE_OUTPUT_TOLERANCE_BPS)) return current;
      if (!current) return steps;
      if (steps.length !== current.length) {
        return steps.length < current.length ? steps : current;
      }
      return BigInt(steps[steps.length - 1].amountOut) >
        BigInt(current[current.length - 1].amountOut)
        ? steps
        : current;
    }, null);
  if (!best) {
    throw new StratoError(`No executable route found for ${input} -> ${output}`, 422, {
      rejections: [...new Map(rejections.map((rejection) => [JSON.stringify(rejection), rejection])).values()],
    });
  }

  const amountOut = BigInt(best[best.length - 1].amountOut);
  const minFinalOut = applyRouteSlippage(amountOut, slippageBps);
  if (minFinalOut <= 0n) {
    throw new Error("Final route output is below the slippage minimum");
  }
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
}: RouteStepQuote): StratoRouteStep => ({
  action: RouteAction[action],
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
  if (!constants.tokenRouter) {
    throw new Error("TOKEN_ROUTER is not configured for this network");
  }
  const amountIn = BigInt(params.amountIn);
  const requestedMinimum = BigInt(params.minFinalOut);
  if (requestedMinimum <= 0n) {
    throw new Error("minFinalOut must be greater than 0");
  }
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
  if (
    !recipient ||
    recipient === constants.ZERO_ADDRESS ||
    recipient === normalizeAddress(constants.tokenRouter)
  ) {
    throw new Error("Invalid route recipient");
  }
  const steps = quote.steps.map(toExecutableRouteStep);
  const transactions: FunctionInput[] = [
    buildTokenApprovalTx(
      normalizeAddress(params.tokenIn),
      normalizeAddress(constants.tokenRouter),
      params.amountIn
    ),
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
