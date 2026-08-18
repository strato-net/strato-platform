import {
  BridgeDepositAction,
  CompositeRouteQuoteResponse,
} from "@strato/shared-types";
import {
  getBridgeableTokens,
  getDepositRouterVersion,
  getNetworkConfigs,
  isAutoRouteEnabled,
} from "./bridge.service";
import { getRouteQuote } from "./route.service";

const WAD = 10n ** 18n;
const DEFAULT_SLIPPAGE_BPS = 50;
const MIN_ACTION_ROUTER_MAJOR = 3;
const MIN_NATIVE_ACTION_ROUTER_MINOR = 1;

const normalizeAddress = (value: string): string =>
  value.toLowerCase().replace(/^0x/, "");

export const supportsAutoRouteRouter = (
  version: string | null,
  nativeDeposit: boolean
): boolean => {
  if (!version) return false;
  const [major, minor = 0] = version.split(".").map(Number);
  return Number.isInteger(major) &&
    Number.isInteger(minor) &&
    (major > MIN_ACTION_ROUTER_MAJOR ||
      (major === MIN_ACTION_ROUTER_MAJOR &&
        (!nativeDeposit || minor >= MIN_NATIVE_ACTION_ROUTER_MINOR)));
};

export const convertExternalToStratoAmount = (
  amount: bigint,
  externalDecimals: number,
  rebaseFactor?: string
): bigint => {
  if (externalDecimals < 0 || externalDecimals > 18) {
    throw new Error("Unsupported external token decimals");
  }
  const rebasedAmount = rebaseFactor
    ? (amount * WAD) / BigInt(rebaseFactor)
    : amount;
  return rebasedAmount * (10n ** BigInt(18 - externalDecimals));
};

export const getCompositeBridgeRouteQuote = async (
  accessToken: string,
  externalChainId: string,
  externalToken: string,
  targetStratoToken: string,
  tokenOut: string,
  amount: bigint,
  slippageBps = DEFAULT_SLIPPAGE_BPS
): Promise<CompositeRouteQuoteResponse> => {
  const routes = await getBridgeableTokens(accessToken, externalChainId);
  const route = routes.find(
    (candidate) =>
      candidate.routeType === "standard" &&
      candidate.enabled &&
      normalizeAddress(candidate.externalToken) === normalizeAddress(externalToken) &&
      normalizeAddress(candidate.stratoToken) === normalizeAddress(targetStratoToken)
  );
  if (!route) {
    throw new Error("No enabled bridge route found");
  }

  const bridgedAmount = convertExternalToStratoAmount(
    amount,
    Number(route.externalDecimals),
    route.rebaseFactor
  );
  if (bridgedAmount <= 0n) {
    throw new Error("Bridge route output is zero");
  }

  const bridge = {
    bridgeRouteId: route.id,
    routeType: "standard" as const,
    externalChainId,
    externalToken: route.externalToken,
    externalSymbol: route.externalSymbol,
    externalDecimals: route.externalDecimals,
    targetStratoToken: route.stratoToken,
    targetStratoSymbol: route.stratoTokenSymbol,
    externalAmount: amount.toString(),
    bridgedAmount: bridgedAmount.toString(),
    rebaseFactor: route.rebaseFactor,
  };

  if (normalizeAddress(route.stratoToken) === normalizeAddress(tokenOut)) {
    return {
      bridge,
      tokenIn: normalizeAddress(route.stratoToken),
      tokenOut: normalizeAddress(tokenOut),
      amountIn: bridgedAmount.toString(),
      amountOut: bridgedAmount.toString(),
      minFinalOut: bridgedAmount.toString(),
      slippageBps,
      deadline: Math.floor(Date.now() / 1000) + 300,
      steps: [],
      depositAction: {
        action: BridgeDepositAction.NONE,
        actionToken: tokenOut,
        minFinalOut: bridgedAmount.toString(),
      },
    };
  }

  const [autoRouteEnabled, networks] = await Promise.all([
    isAutoRouteEnabled(
      accessToken,
      route.externalToken,
      externalChainId,
      route.stratoToken
    ),
    getNetworkConfigs(accessToken),
  ]);
  if (!autoRouteEnabled) {
    throw new Error("Automatic routing is not enabled for this bridge route");
  }

  const network = networks.find(
    (candidate) => String(candidate.externalChainId) === externalChainId
  );
  const routerVersion = network?.chainInfo.depositRouter
    ? await getDepositRouterVersion(externalChainId, network.chainInfo.depositRouter)
    : null;
  if (!supportsAutoRouteRouter(routerVersion, BigInt(route.externalToken || "0") === 0n)) {
    throw new Error("The selected bridge router does not support automatic routing");
  }

  const internalQuote = await getRouteQuote(
    accessToken,
    route.stratoToken,
    tokenOut,
    bridgedAmount,
    slippageBps
  );
  return {
    bridge,
    ...internalQuote,
    depositAction: {
      action: BridgeDepositAction.AUTO_ROUTE,
      actionToken: tokenOut,
      minFinalOut: internalQuote.minFinalOut,
    },
  };
};
