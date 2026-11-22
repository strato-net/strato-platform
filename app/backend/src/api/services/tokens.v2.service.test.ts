import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import * as oracleHelper from "../helpers/oracle.helper";
import { getNetBalance } from "./tokens.v2.service";

// Each test starts a minute after the previous one, past the TTL of the shared state it left.
let clock = Date.now();
const freshSharedState = (t: TestContext) =>
  t.mock.timers.enable({ apis: ["Date"], now: (clock += 60_000) });

test("getNetBalance fails instead of returning minus the debt when the wallet's tokens cannot be read", async (t) => {
  const user = "1111111111111111111111111111111111111111";

  freshSharedState(t);
  t.mock.method(oracleHelper, "getCompletePriceMap", async () => new Map());

  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    if (path === `/${constants.Token}`) {
      throw new Error("Cirrus unavailable");
    }

    if (path === `/${constants.LendingRegistry}`) {
      return {
        data: [{
          lendingPool: {
            borrowIndex: "1000000000000000000000000000",
            borrowableAsset: constants.USDST,
            assetConfigs: [{ asset: constants.USDST }],
            userLoan: [{ user, LoanInfo: { scaledDebt: "5000000000000000000", lastUpdated: "0" } }],
          },
        }],
      };
    }

    if (path === `/${constants.CDPRegistry}`) {
      return { data: [{ cdpEngine: { address: "2222222222222222222222222222222222222222" } }] };
    }

    return { data: [] };
  });

  await assert.rejects(getNetBalance("access-token", user), /Cirrus unavailable/);
});

test("getNetBalance fails when a deployed saveUSDST vault's share balance cannot be read, unless its table does not exist yet", async (t) => {
  const user = "1111111111111111111111111111111111111111";
  const vault = "3333333333333333333333333333333333333333";
  let shareBalanceError: unknown = new Error("Cirrus unavailable");

  freshSharedState(t);
  const previousSaveUsdstVault = config.saveUsdstVault;
  (config as any).saveUsdstVault = vault;
  t.after(() => {
    (config as any).saveUsdstVault = previousSaveUsdstVault;
  });

  t.mock.method(oracleHelper, "getCompletePriceMap", async () => new Map());

  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    if (path === `/${constants.SaveUSDSTVault}-_balances`) {
      throw shareBalanceError;
    }

    if (path === `/${constants.SaveUSDSTVault}`) {
      return { data: [{ address: vault, assetToken: constants.USDST }] };
    }

    if (path === `/${constants.LendingRegistry}`) {
      return {
        data: [{ lendingPool: { borrowableAsset: constants.USDST, assetConfigs: [{ asset: constants.USDST }] } }],
      };
    }

    if (path === `/${constants.CDPRegistry}`) {
      return { data: [{ cdpEngine: { address: "2222222222222222222222222222222222222222" } }] };
    }

    return { data: [] };
  });

  await assert.rejects(getNetBalance("access-token", user), /Cirrus unavailable/);

  shareBalanceError = { response: { data: { code: "42P01" } } };
  assert.deepEqual(await getNetBalance("access-token", user), {
    netBalance: 0,
    totalBorrowed: 0,
    totalAssetValue: 0,
  });
});
