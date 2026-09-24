import {
  BridgeDepositAction,
  CompositeRouteQuoteResponse,
} from "@strato/shared-types";
import { constants } from "../../config/constants";
import { cirrus } from "../../utils/appApiHelper";
import {
  getBridgeableTokens,
  getDepositRouterVersion,
  getNetworkConfigs,
  isAutoRouteEnabled,
} from "./bridge.service";
import { applyRouteSlippage, getRouteQuote } from "./route.service";
import { TRADE_DEADLINE_SECONDS } from "./trade.service";

const WAD = 10n ** 18n;
const DEFAULT_SLIPPAGE_BPS = 50;
const ZERO_ADDRESS = "0".repeat(40);

const normalizeAddress = (value: string): string =>
  value.toLowerCase().replace(/^0x/, "");

export const supportsAutoRouteRouter = (
  version: string | null,
  nativeDeposit: boolean
): boolean => {
  if (!version) return false;
  const [major, minor = 0] = version.split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
  return nativeDeposit
    ? major > 3 || (major === 3 && minor >= 2)
    : major >= 3;
};

export const convertExternalToStratoAmount = (
  amount: bigint,
  externalDecimals: number,
  rebaseFactor?: string
): bigint => {
  if (!Number.isInteger(externalDecimals) || externalDecimals < 0 || externalDecimals > 18) {
    throw new Error("Unsupported external token decimals");
  }
  const scaledAmount = amount * 10n ** BigInt(18 - externalDecimals);
  return rebaseFactor ? (scaledAmount * WAD) / BigInt(rebaseFactor) : scaledAmount;
};

const isRouteRebaseRequired = async (
  accessToken: string,
  externalToken: string,
  externalChainId: string,
  targetStratoToken: string
): Promise<boolean> => {
  const { data } = await cirrus.get(
    accessToken,
    `/${constants.ExternalAssetBridge}-routeRebaseRequired`,
    {
      params: {
        address: `eq.${constants.externalAssetBridge}`,
        key: `eq.${normalizeAddress(externalToken)}`,
        key2: `eq.${externalChainId}`,
        key3: `eq.${normalizeAddress(targetStratoToken)}`,
        select: "value",
        limit: "1",
      },
    }
  );
  return data?.[0]?.value === true || String(data?.[0]?.value) === "true";
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
  applyRouteSlippage(amount, slippageBps);
  const routes = await getBridgeableTokens(accessToken, externalChainId);
  const route = routes.find(
    (candidate) =>
      candidate.enabled &&
      (candidate.routeType === "native"
        ? !candidate.depositsPaused && !candidate.depositsDisabled && !!candidate.externalBridge
        : candidate.depositsEnabled === true) &&
      normalizeAddress(candidate.externalToken) ===
        normalizeAddress(externalToken) &&
      normalizeAddress(candidate.stratoToken) ===
        normalizeAddress(targetStratoToken)
  );
  if (!route) throw new Error("No enabled bridge route found");
  if (route.externalDecimals == null || !/^\d+$/.test(String(route.externalDecimals))) {
    throw new Error("Unsupported external token decimals");
  }

  const nativeRedemption = route.routeType === "native";
  const requiresRebase = !nativeRedemption && await isRouteRebaseRequired(
    accessToken,
    route.externalToken,
    externalChainId,
    route.stratoToken
  );
  if (requiresRebase && !route.rebaseFactor) {
    throw new Error("Rebase factor unavailable for required bridge route");
  }
  const bridgedAmount = nativeRedemption ? amount : convertExternalToStratoAmount(
    amount,
    Number(route.externalDecimals),
    requiresRebase ? route.rebaseFactor : undefined
  );
  if (bridgedAmount <= 0n) {
    throw new Error("Bridge route output is zero");
  }

  const bridge = {
    bridgeRouteId: route.id,
    routeType: route.routeType,
    ...(nativeRedemption ? { externalBridge: route.externalBridge } : {}),
    externalChainId,
    externalToken: route.externalToken,
    externalSymbol: route.externalSymbol,
    externalDecimals: route.externalDecimals,
    targetStratoToken: route.stratoToken,
    targetStratoSymbol: route.stratoTokenSymbol,
    externalAmount: amount.toString(),
    bridgedAmount: bridgedAmount.toString(),
    rebaseFactor: requiresRebase ? route.rebaseFactor : undefined,
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
      deadline: Math.floor(Date.now() / 1000) + TRADE_DEADLINE_SECONDS,
      steps: [],
      depositAction: {
        action: BridgeDepositAction.NONE,
        actionToken: tokenOut,
        minFinalOut: bridgedAmount.toString(),
      },
    };
  }

  if (nativeRedemption) {
    const [version, { data }, { data: permissions }] = await Promise.all([
      getDepositRouterVersion(externalChainId, route.externalBridge!),
      cirrus.get(accessToken, "/storage", {
        params: { address: `eq.${constants.stratoNativeBridge}`, select: "data->>tokenRouter", limit: "1" },
      }),
      cirrus.get(accessToken, `/${constants.StratoNativeBridge}-autoRouteEnabled`, {
        params: { address: `eq.${constants.stratoNativeBridge}`, key: `eq.${normalizeAddress(route.stratoToken)}`,
          key2: `eq.${externalChainId}`, select: "value", limit: "1" },
      }),
    ]);
    if (String(permissions?.[0]?.value).toLowerCase() !== "true") {
      throw new Error("Automatic routing is disabled for this native bridge route");
    }
    const [major, minor] = (version || "").split(".").map(Number);
    if (!(major > 1 || (major === 1 && minor >= 2)) ||
        !data?.[0]?.tokenRouter || !constants.tokenRouter ||
        normalizeAddress(data[0].tokenRouter) === ZERO_ADDRESS ||
        normalizeAddress(data[0].tokenRouter) !== normalizeAddress(constants.tokenRouter)) {
      throw new Error("The native bridge is not configured for automatic routing");
    }
  } else {
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
    const version = network?.chainInfo.depositRouter
      ? await getDepositRouterVersion(
          externalChainId,
          network.chainInfo.depositRouter
        )
      : null;
    const nativeDeposit =
      normalizeAddress(route.externalToken) === ZERO_ADDRESS;
    if (!supportsAutoRouteRouter(version, nativeDeposit)) {
      throw new Error(
        "The selected bridge router does not support automatic routing"
      );
    }
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
