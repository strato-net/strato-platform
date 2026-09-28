import assert from "node:assert/strict";
import test from "node:test";
import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import * as oracleHelper from "../helpers/oracle.helper";
import { getBalance } from "./tokens.service";

test("returns saveUSDST balances for exact address filters", async (t) => {
  const saveUsdstVault = "1111111111111111111111111111111111111111";
  const user = "2222222222222222222222222222222222222222";
  const collateralToken = "3333333333333333333333333333333333333333";
  const balance = "123000000000000000000";

  const previousSaveUsdstVault = config.saveUsdstVault;
  (config as any).saveUsdstVault = `0x${saveUsdstVault}`;
  t.after(() => {
    (config as any).saveUsdstVault = previousSaveUsdstVault;
  });

  t.mock.method(oracleHelper, "getCompletePriceMap", async () =>
    new Map([[saveUsdstVault, "1000000000000000000"]])
  );

  t.mock.method(cirrus, "get", async (_token: string, path: string, request?: any) => {
    const params = request?.params || {};

    if (path === `/${constants.Token}-_balances`) {
      return { status: 200, data: [] };
    }

    if (path === `/${constants.SaveUSDSTVault}-_balances`) {
      assert.equal(params.address, `eq.${saveUsdstVault}`);
      assert.equal(params.key, `eq.${user}`);
      assert.equal(params.select, "address,user:key,balance:value::text");
      return {
        status: 200,
        data: [{ address: saveUsdstVault, user, balance }],
      };
    }

    if (path === `/${constants.SaveUSDSTVault}`) {
      assert.equal(params.address, `eq.${saveUsdstVault}`);
      return {
        status: 200,
        data: [{
          address: saveUsdstVault,
          _name: "Save USDST",
          _symbol: "saveUSDST",
          _paused: false,
        }],
      };
    }

    if (path === `/${constants.CollateralVault}-userCollaterals`) {
      return {
        status: 200,
        data: [{ asset: collateralToken, amount: "1" }],
      };
    }

    if (path === `/${constants.CDPEngine}-vaults`) {
      return { status: 200, data: [] };
    }

    if (path === `/${constants.Token}`) {
      return {
        status: 200,
        data: [{ address: collateralToken, _symbol: "OTHER" }],
      };
    }

    assert.fail(`Unexpected Cirrus path: ${path}`);
  });

  const rows = await getBalance("access-token", user, {
    address: `eq.0x${saveUsdstVault}`,
  });

  assert.deepEqual(rows.map((row: any) => ({
    address: row.address,
    balance: row.balance,
    symbol: row.token?._symbol,
  })), [{
    address: saveUsdstVault,
    balance,
    symbol: "saveUSDST",
  }]);
});

test("logs saveUSDST balance query failures before falling back", async (t) => {
  const saveUsdstVault = "1111111111111111111111111111111111111111";
  const user = "2222222222222222222222222222222222222222";

  const previousSaveUsdstVault = config.saveUsdstVault;
  (config as any).saveUsdstVault = saveUsdstVault;
  t.after(() => {
    (config as any).saveUsdstVault = previousSaveUsdstVault;
  });

  t.mock.method(oracleHelper, "getCompletePriceMap", async () => new Map());

  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", ((...args: unknown[]) => {
    warnings.push(args);
  }) as typeof console.warn);

  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    if (path === `/${constants.Token}-_balances`) {
      return { status: 200, data: [] };
    }

    if (path === `/${constants.SaveUSDSTVault}-_balances`) {
      throw new Error("Cirrus unavailable");
    }

    if (
      path === `/${constants.CollateralVault}-userCollaterals`
      || path === `/${constants.CDPEngine}-vaults`
    ) {
      return { status: 200, data: [] };
    }

    assert.fail(`Unexpected Cirrus path: ${path}`);
  });

  const rows = await getBalance("access-token", user, {
    address: `eq.${saveUsdstVault}`,
  });

  assert.deepEqual(rows, []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], "Failed to fetch saveUSDST vault balance:");
  assert.deepEqual(warnings[0][1], {
    vaultAddress: saveUsdstVault,
    error: "Cirrus unavailable",
  });
});
