import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { constants } from "../../config/constants";
import * as rpcConfig from "../../config/rpc.config";
import { buildDepositActionCatalog, getDepositRouterMajor } from "./bridge.service";
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
      { autoForge: true, autoSave: true, autoRoute: false },
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
    { autoForge: false, autoSave: true, autoRoute: false }
  );
  const saveOnlyActions = buildDepositActionCatalog({
    ...base,
    bridgeActionRoutes: saveOnlyRoutes,
  });
  assert.equal(saveOnlyActions.filter(({ payToken, action }) => payToken === usdc && action === 2).length, 0);
  assert.equal(saveOnlyActions.filter(({ payToken, action }) => payToken === usdc && action === 3).length, 1);

  assert.deepEqual(buildDepositActionCatalog({ ...base, actionChainIds: new Set() }), []);
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
