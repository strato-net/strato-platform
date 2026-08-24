import {
  BridgeDepositAction,
  CompositeRouteQuoteResponse,
} from "@strato/shared-types";
import {
  getBridgeableTokens,
  getDepositRouterMajor,
  getNetworkConfigs,
  isAutoRouteEnabled,
} from "./bridge.service";
import { getRouteQuote } from "./route.service";

const WAD = 10n ** 18n;
const DEFAULT_SLIPPAGE_BPS = 50;
const MIN_ACTION_ROUTER_MAJOR = 3;
const ZERO_ADDRESS = "0".repeat(40);

const normalizeAddress = (value: string): string =>
  value.toLowerCase().replace(/^0x/, "");

export const getBridgeRouteMode = (
  externalToken: string,
  targetStratoToken: string,
  tokenOut: string
): "direct" | "auto-route" | "unsupported-native-route" => {
  if (normalizeAddress(targetStratoToken) === normalizeAddress(tokenOut)) {
    return "direct";
  }
  return normalizeAddress(externalToken) === ZERO_ADDRESS
    ? "unsupported-native-route"
    : "auto-route";
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

  const routeMode = getBridgeRouteMode(
    route.externalToken,
    route.stratoToken,
    tokenOut
  );
  if (routeMode === "direct") {
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
  if (routeMode === "unsupported-native-route") {
    throw new Error("Native ETH automatic routing is not supported");
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
  const routerMajor = network?.chainInfo.depositRouter
    ? await getDepositRouterMajor(externalChainId, network.chainInfo.depositRouter)
    : null;
  if (routerMajor === null || routerMajor < MIN_ACTION_ROUTER_MAJOR) {
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
