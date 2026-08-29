import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { constants } from "../../config/constants";
import * as rpcConfig from "../../config/rpc.config";
import {
  buildDepositActionCatalog,
  getDepositRouterMajor,
  validateNativeWithdrawalRoute,
} from "./bridge.service";
import {
  parseNativeBridgeAssets,
  parseNativeLockedBalances,
  parseNativeTokenBridgeConfigs,
  parseBridgeRouteMappings,
  LEGACY_QUERY_CONFIGS,
  getDepositOutcomeIdentity,
  QUERY_CONFIGS,
} from "../helpers/bridge.helper";
import type { BridgeToken } from "@strato/shared-types";

const route = (
  id: string,
  externalChainId: string,
  stratoToken: string,
  enabled = true
): BridgeToken => ({
  id,
  routeType: "standard",
  stratoToken,
  stratoTokenName: id,
  stratoTokenSymbol: id,
  externalChainId,
  externalName: id,
  externalToken: `0x${id.padStart(40, "0")}`,
  externalSymbol: id,
  externalDecimals: "18",
  maxPerWithdrawal: "0",
  enabled,
});

test("selects router-scoped deposit identity and transaction metadata", () => {
  assert.match(QUERY_CONFIGS.deposit.selectFields, /depositRouter:key2/);
  assert.match(QUERY_CONFIGS.deposit.selectFields, /depositId:key3/);
  assert.match(
    QUERY_CONFIGS.deposit.selectFields,
    /externalTxHash:value->>externalTxHash/,
  );
});

test("keeps the legacy MercataBridge deposit query on its original keys", () => {
  assert.match(LEGACY_QUERY_CONFIGS.deposit.selectFields, /externalTxHash:key2/);
  assert.doesNotMatch(LEGACY_QUERY_CONFIGS.deposit.selectFields, /key3/);
});

test("correlates action outcomes by router-scoped deposit identity", () => {
  const txHash = "0xabc";
  assert.notEqual(
    getDepositOutcomeIdentity("1", "0x1111111111111111111111111111111111111111", "1", txHash),
    getDepositOutcomeIdentity("1", "0x1111111111111111111111111111111111111111", "2", txHash),
  );
  assert.equal(
    getDepositOutcomeIdentity(undefined, undefined, undefined, txHash),
    txHash,
  );
});

test("builds actions only for eligible routes and configured products", () => {
  const usdc = "0x1111111111111111111111111111111111111111";
  const vault = "0x2222222222222222222222222222222222222222";
  const metal = "0x3333333333333333333333333333333333333333";
  const routes = [
    route("usdc-1", "1", usdc),
    route("usdc-2", "2", usdc),
    route("usdst-1", "1", constants.USDST),
    route("disabled", "1", "0x4444444444444444444444444444444444444444", false),
  ];
  const bridgeActionRoutes = new Map(
    routes.map((item) => [
      [
        item.externalToken?.toLowerCase().replace(/^0x/, ""),
        String(item.externalChainId),
        item.stratoToken.toLowerCase().replace(/^0x/, ""),
      ].join(":"),
      { autoForge: false, autoSave: false, autoRoute: true },
    ])
  );
  const base = {
    routes,
    actionChainIds: new Set(["1"]),
    psmState: {
      mintableToken: constants.USDST,
      mintPaused: false,
      mintConfigs: new Map([
        [usdc.slice(2), { isEnabled: true, maxBalance: "1000", feeBps: "25" }],
      ]),
    },
    saveState: {
      vaultAddress: vault,
      assetAddress: constants.USDST,
      shareSymbol: "saveUSDST",
      projectedExchangeRate: "1000000000000000000",
      paused: false,
    },
    forgeConfigs: {
      payTokens: [{ address: constants.USDST, symbol: "USDST", name: "USDST", imageUrl: "", price: "1" }],
      metals: [{
        address: metal,
        symbol: "GOLDST",
        name: "Gold",
        imageUrl: "",
        isEnabled: true,
        mintCap: "1000",
        feeBps: "50",
        totalMinted: "100",
        price: "2000",
      }],
    },
    bridgeActionConfig: {
      directMintPsm: constants.directMintPsm,
      saveUsdstVault: vault,
    },
    bridgeActionRoutes,
  };

  const actions = buildDepositActionCatalog(base);

  assert.equal(actions.length, 4);
  assert.deepEqual(new Set(actions.map(({ action }) => action)), new Set([4]));
  assert.ok(actions.every(({ externalChainIds }) => externalChainIds.join() === "1"));
  assert.ok(actions.filter(({ payToken }) => payToken === usdc).every(({ psmFeeBps }) => psmFeeBps === "25"));
  assert.ok(actions.filter(({ payToken }) => payToken === constants.USDST).every(({ psmFeeBps }) => psmFeeBps === "0"));
  assert.ok(actions.filter(({ id }) => id.startsWith("save-")).every(({ oraclePrice }) => oraclePrice === "1000000000000000000"));

  const pausedPsmActions = buildDepositActionCatalog({
    ...base,
    psmState: { ...base.psmState, mintPaused: true },
  });
  assert.ok(pausedPsmActions.every(({ payToken }) => payToken === constants.USDST));

  const disabledRouteActions = new Map(bridgeActionRoutes);
  const usdcRoute = routes[0];
  disabledRouteActions.set(
    [
      usdcRoute.externalToken?.toLowerCase().replace(/^0x/, ""),
      String(usdcRoute.externalChainId),
      usdcRoute.stratoToken.toLowerCase().replace(/^0x/, ""),
    ].join(":"),
    { autoForge: false, autoSave: false, autoRoute: false }
  );
  const routeDisabledActions = buildDepositActionCatalog({
    ...base,
    bridgeActionRoutes: disabledRouteActions,
  });
  assert.equal(
    routeDisabledActions.filter(({ payToken }) => payToken === usdc).length,
    0
  );

  assert.deepEqual(buildDepositActionCatalog({ ...base, actionChainIds: new Set() }), []);
});

test("parses ExternalAssetBridge route controls", () => {
  const routes = parseBridgeRouteMappings([{
    externalToken: "1111111111111111111111111111111111111111",
    externalChainId: "1",
    targetStratoToken: "2222222222222222222222222222222222222222",
    mappingValue: {
      depositsEnabled: true,
      withdrawalsEnabled: false,
      externalDecimals: "6",
      externalName: "USD Coin",
      externalSymbol: "USDC",
      maxPerWithdrawal: "1000000",
      manualReviewThreshold: "500000",
    },
  }]);

  assert.equal(routes.length, 1);
  assert.equal(routes[0].AssetInfo.enabled, true);
  assert.equal(routes[0].AssetInfo.depositsEnabled, true);
  assert.equal(routes[0].AssetInfo.withdrawalsEnabled, false);
  assert.equal(routes[0].AssetInfo.manualReviewThreshold, "500000");
});

test("adds token-specific native bridge controls to routes", () => {
  const stratoToken = "1111111111111111111111111111111111111111";
  const tokenConfigs = parseNativeTokenBridgeConfigs([{
    key: stratoToken,
    value: {
      depositsDisabled: true,
      withdrawalsDisabled: false,
      maxOutstandingWithdrawal: "100000000000000000000",
    },
  }]);
  const lockedBalances = parseNativeLockedBalances([{
    key: stratoToken,
    lockedBalance: "75000000000000000000",
  }]);
  const routes = parseNativeBridgeAssets([{
    key: stratoToken,
    key2: "1",
    value: {
      enabled: true,
      externalBridge: "2222222222222222222222222222222222222222",
      representationToken: "3333333333333333333333333333333333333333",
      externalName: "Native token",
      externalSymbol: "NATIVE",
      maxPerWithdrawal: "50000000000000000000",
      instantWithdrawalThreshold: "0",
    },
  }], {}, tokenConfigs, lockedBalances);

  assert.equal(routes.length, 1);
  assert.equal(routes[0].AssetInfo.depositsDisabled, true);
  assert.equal(routes[0].AssetInfo.withdrawalsDisabled, false);
  assert.equal(routes[0].AssetInfo.maxOutstandingWithdrawal, "100000000000000000000");
  assert.equal(routes[0].AssetInfo.outstandingWithdrawal, "75000000000000000000");
  assert.equal(routes[0].AssetInfo.remainingOutstandingWithdrawal, "25000000000000000000");
});

test("rejects native withdrawals that are disabled or exceed remaining capacity", () => {
  const nativeRoute: BridgeToken = {
    ...route("native", "1", "0x1111111111111111111111111111111111111111"),
    routeType: "native",
    withdrawalsDisabled: false,
    maxPerWithdrawal: "50000000000000000000",
    maxOutstandingWithdrawal: "100000000000000000000",
    outstandingWithdrawal: "75000000000000000000",
    remainingOutstandingWithdrawal: "25000000000000000000",
  };

  assert.doesNotThrow(() =>
    validateNativeWithdrawalRoute(nativeRoute, "25000000000000000000")
  );
  assert.throws(
    () => validateNativeWithdrawalRoute(nativeRoute, "25000000000000000001"),
    /remaining aggregate capacity/
  );
  assert.throws(
    () => validateNativeWithdrawalRoute({ ...nativeRoute, withdrawalsDisabled: true }, "1"),
    /withdrawals are disabled/
  );
});

const encodeAbiString = (value: string): string => {
  const hex = Buffer.from(value, "utf8").toString("hex");
  const length = value.length.toString(16).padStart(64, "0");
  const padded = hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, "0");
  return `0x${"20".padStart(64, "0")}${length}${padded}`;
};

test("getDepositRouterMajor tries the fallback RPC when the primary returns a JSON-RPC error", async (t) => {
  const upstream = "http://primary.invalid";
  const fallback = "http://fallback.invalid";
  t.mock.method(rpcConfig, "getRpcUpstream", () => ({ upstream, fallback }));

  const calls: string[] = [];
  t.mock.method(axios, "post", (async (url: string) => {
    calls.push(url);
    if (url === upstream) {
      return { data: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } } };
    }
    return { data: { jsonrpc: "2.0", id: 1, result: encodeAbiString("3.0.1") } };
  }) as typeof axios.post);

  const major = await getDepositRouterMajor("1", "0x1111111111111111111111111111111111111111");
  assert.equal(major, 3);
  assert.deepEqual(calls, [upstream, fallback]);
});
