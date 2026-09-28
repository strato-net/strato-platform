import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import * as oracleHelper from "../helpers/oracle.helper";
import * as rpcConfig from "../../config/rpc.config";
import {
  buildDepositActionCatalog,
  getBridgeTransferContractName,
  getDepositRouterMajor,
  getWithdrawalSummary,
  validateNativeWithdrawalRoute,
} from "./bridge.service";
import {
  parseNativeBridgeAssets,
  parseNativeLockedBalances,
  parseNativeTokenBridgeConfigs,
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
  isDefaultRoute: true,
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
      { autoForge: true, autoSave: true },
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
  assert.deepEqual(new Set(actions.map(({ action }) => action)), new Set([2, 3]));
  assert.ok(actions.every(({ externalChainIds }) => externalChainIds.join() === "1"));
  assert.ok(actions.filter(({ payToken }) => payToken === usdc).every(({ psmFeeBps }) => psmFeeBps === "25"));
  assert.ok(actions.filter(({ payToken }) => payToken === constants.USDST).every(({ psmFeeBps }) => psmFeeBps === "0"));
  assert.ok(actions.filter(({ action }) => action === 3).every(({ oraclePrice }) => oraclePrice === "1000000000000000000"));

  const pausedPsmActions = buildDepositActionCatalog({
    ...base,
    psmState: { ...base.psmState, mintPaused: true },
  });
  assert.ok(pausedPsmActions.every(({ payToken }) => payToken === constants.USDST));

  const saveOnlyRoutes = new Map(bridgeActionRoutes);
  const usdcRoute = routes[0];
  saveOnlyRoutes.set(
    [
      usdcRoute.externalToken?.toLowerCase().replace(/^0x/, ""),
      String(usdcRoute.externalChainId),
      usdcRoute.stratoToken.toLowerCase().replace(/^0x/, ""),
    ].join(":"),
    { autoForge: false, autoSave: true }
  );
  const saveOnlyActions = buildDepositActionCatalog({
    ...base,
    bridgeActionRoutes: saveOnlyRoutes,
  });
  assert.equal(saveOnlyActions.filter(({ payToken, action }) => payToken === usdc && action === 2).length, 0);
  assert.equal(saveOnlyActions.filter(({ payToken, action }) => payToken === usdc && action === 3).length, 1);

  assert.deepEqual(buildDepositActionCatalog({ ...base, actionChainIds: new Set() }), []);
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

test("uses the saveUSDST vault ABI for native withdrawal approvals", () => {
  const saveUsdstVault = "0x1111111111111111111111111111111111111111";

  assert.equal(
    getBridgeTransferContractName(saveUsdstVault, saveUsdstVault.slice(2)),
    "SaveUSDSTVault"
  );
  assert.equal(
    getBridgeTransferContractName("0x2222222222222222222222222222222222222222", saveUsdstVault),
    "Token"
  );
});

test("withdrawal summary uses normalized route balances with WAD-scaled USD values", async (t) => {
  const nativeBridge = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const custodyVault = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const stratoToken = "1111111111111111111111111111111111111111";
  const user = "2222222222222222222222222222222222222222";
  const balance = "2000000000000000000";
  const price = "3000000000000000000";

  const previousNativeBridge = config.stratoNativeBridge;
  const previousCustodyVault = config.stratoNativeCustodyVault;
  (config as any).stratoNativeBridge = nativeBridge;
  (config as any).stratoNativeCustodyVault = custodyVault;
  t.after(() => {
    (config as any).stratoNativeBridge = previousNativeBridge;
    (config as any).stratoNativeCustodyVault = previousCustodyVault;
  });

  t.mock.method(oracleHelper, "getCompletePriceMap", async () =>
    new Map([[stratoToken, price]])
  );

  t.mock.method(cirrus, "get", async (_token: string, path: string, request?: any) => {
    const params = request?.params || {};

    if (path === "/mapping") {
      return { status: 200, data: [] };
    }

    if (path === `/${constants.StratoNativeBridge}-assets`) {
      assert.equal(params.address, `eq.${nativeBridge}`);
      return {
        status: 200,
        data: [{
          key: stratoToken,
          key2: "1",
          value: {
            enabled: true,
            externalBridge: "3333333333333333333333333333333333333333",
            representationToken: "4444444444444444444444444444444444444444",
            externalName: "Native Token",
            externalSymbol: "NATIVE",
            maxPerWithdrawal: "0",
            instantWithdrawalThreshold: "0",
          },
        }],
      };
    }

    if (path === `/${constants.StratoNativeBridge}`) {
      return { status: 200, data: [{ depositsPaused: false, withdrawalsPaused: false }] };
    }

    if (
      path === `/${constants.StratoNativeBridge}-tokenBridgeConfigs`
      || path === `/${constants.StratoNativeCustodyVault}-lockedBalance`
    ) {
      return { status: 200, data: [] };
    }

    if (path === `/${constants.Token}`) {
      return {
        status: 200,
        data: [{
          address: stratoToken,
          _name: "Native Token",
          _symbol: "NATIVE",
          status: "2",
          images: [],
        }],
      };
    }

    if (path === `/${constants.PriceOracle}-rebaseFactors`) {
      return { status: 200, data: [] };
    }

    if (path === `/${constants.Token}-_balances`) {
      assert.equal(params.address, `in.(${stratoToken})`);
      assert.equal(params.key, `eq.${user}`);
      return { status: 200, data: [{ address: stratoToken, balance }] };
    }

    if (
      path === `/${constants.MercataBridge}-withdrawals`
      || path === `/${constants.StratoNativeBridge}-withdrawals`
    ) {
      return { status: 200, data: [] };
    }

    assert.fail(`Unexpected Cirrus path: ${path}`);
  });

  const summary = await getWithdrawalSummary("access-token", user);

  assert.equal(summary.availableToWithdraw, "6000000000000000000");
  assert.equal(summary.pendingWithdrawals, "0");
  assert.equal(summary.totalWithdrawn30d, "0");
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
