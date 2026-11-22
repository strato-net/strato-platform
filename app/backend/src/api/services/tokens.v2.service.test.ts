import assert from "node:assert/strict";
import test from "node:test";
import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import * as oracleHelper from "../helpers/oracle.helper";
import { getNetBalance } from "./tokens.v2.service";

test("getNetBalance fails instead of returning minus the debt when the wallet's tokens cannot be read", async (t) => {
  const user = "1111111111111111111111111111111111111111";

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
