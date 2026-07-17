import assert from "node:assert/strict";
import test from "node:test";
import { constants } from "../../config/constants";
import { buildDepositActionCatalog } from "./bridge.service";
import type { BridgeToken } from "@mercata/shared-types";

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

  assert.deepEqual(buildDepositActionCatalog({ ...base, actionChainIds: new Set() }), []);
});
