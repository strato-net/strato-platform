import assert from "node:assert/strict";
import test from "node:test";
import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import { getVaults } from "./cdp.service";

test("getVaults reads the registry once and all vault tokens in one query", async (t) => {
  const user = "1111111111111111111111111111111111111111";
  const known = "2222222222222222222222222222222222222222";
  const unknown = "3333333333333333333333333333333333333333";
  const collateralConfig = {
    unitScale: "1000000000000000000",
    liquidationRatio: "1500000000000000000",
    stabilityFeeRate: "1000000000000000000000000000",
  };
  const paths: string[] = [];

  t.mock.method(cirrus, "get", async (_token: string, path: string, request?: any) => {
    paths.push(path);

    if (path === `/${constants.CDPRegistry}`) {
      return {
        data: [{
          cdpEngine: {
            address: "4444444444444444444444444444444444444444",
            collateralConfigs: [known, unknown].map((asset) => ({ asset, CollateralConfig: collateralConfig })),
          },
        }],
      };
    }

    if (path === `/${constants.CDPEngine}-vaults`) {
      return {
        data: [known, unknown].map((asset) => ({ user, asset, Vault: { collateral: "1", scaledDebt: "0" } })),
      };
    }

    if (path === `/${constants.Token}`) {
      assert.equal(request.params.address, `in.(${known},${unknown})`);
      return { data: [{ address: known, _symbol: "WBTC", customDecimals: 8 }] };
    }

    assert.fail(`Unexpected Cirrus path: ${path}`);
  });

  const vaults = await getVaults("access-token", user);

  assert.deepEqual(
    vaults.map((vault) => [vault.asset, vault.symbol, vault.collateralAmountDecimals]),
    [[known, "WBTC", 8], [unknown, "UNKNOWN", 18]]
  );
  assert.equal(paths.filter((path) => path === `/${constants.Token}`).length, 1);
  assert.equal(paths.filter((path) => path === `/${constants.CDPRegistry}`).length, 1);
});
