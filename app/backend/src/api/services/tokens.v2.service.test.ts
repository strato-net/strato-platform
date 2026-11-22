import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import { markFailedNodeCall, nodeCallWatch } from "../../utils/sharedPromise";
import * as oracleHelper from "../helpers/oracle.helper";
import { getEarningAssets, getNetBalance } from "./tokens.v2.service";

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
  // The asset list stays tolerant: it shows the vault without the position.
  assert.deepEqual(
    (await getEarningAssets("access-token", user)).map(({ address, balance }) => ({ address, balance })),
    [{ address: vault, balance: "0" }]
  );

  shareBalanceError = { response: { data: { code: "42P01" } } };
  assert.deepEqual(await getNetBalance("access-token", user), {
    netBalance: 0,
    totalBorrowed: 0,
    totalAssetValue: 0,
  });
});

// The node's answers for a wallet that holds and owes nothing.
const emptyWallet = (path: string) => {
  if (path === `/${constants.LendingRegistry}`) {
    return {
      data: [{ lendingPool: { borrowableAsset: constants.USDST, assetConfigs: [{ asset: constants.USDST }] } }],
    };
  }

  if (path === `/${constants.CDPRegistry}`) {
    return { data: [{ cdpEngine: { address: "2222222222222222222222222222222222222222" } }] };
  }

  return { data: [] };
};

test("getNetBalance fails when a read that a service answers with a default had a failed node call", async (t) => {
  const user = "1111111111111111111111111111111111111111";
  const vaultsRead = `/${constants.CDPEngine}-vaults`;

  freshSharedState(t);
  t.mock.method(console, "warn", () => {});
  t.mock.method(oracleHelper, "getCompletePriceMap", async () => new Map());

  t.mock.method(cirrus, "get", async (_token: string, path: string, options?: { params?: Record<string, string> }) => {
    // The debt read (the one filtered by engine address) fails as the axios interceptor
    // reports it. getUserVaults answers it with no vaults.
    if (path === vaultsRead && options?.params?.address) {
      nodeCallWatch.getStore()!.failedCall = `${vaultsRead} 503`;
      throw new Error("Cirrus unavailable");
    }

    return emptyWallet(path);
  });

  await assert.rejects(getNetBalance("access-token", user), {
    message: `Net balance: node call failed: ${vaultsRead} 503`,
  });
});

test("getNetBalance fails when a node call failed inside the shared load that answers it", async (t) => {
  freshSharedState(t);
  const warn = t.mock.method(console, "warn", () => {});
  // The price map load carries on after a failed read, as the real one does for some.
  t.mock.method(oracleHelper, "getCompletePriceMap", async () => {
    nodeCallWatch.getStore()!.failedCall = "/BlockApps-Pool 503";
    return new Map();
  });
  t.mock.method(cirrus, "get", async (_token: string, path: string) => emptyWallet(path));

  await assert.rejects(getNetBalance("access-token", "1111111111111111111111111111111111111111"), {
    message: "Net balance: node call failed: /BlockApps-Pool 503",
  });
  // The mark was the load's own, not the request's.
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [
    ["Shared state priceMap not cached: node call failed: /BlockApps-Pool 503"],
  ]);
});

test("getNetBalance answers zeros and the asset list resolves on a network whose collateral, lending and CDP tables do not exist yet", async (t) => {
  const user = "1111111111111111111111111111111111111111";
  // The node's error answer, passed through what the axios interceptor does with it.
  const nodeError = (path: string, status: number, code: string) => {
    const error = { config: { url: path }, response: { status, data: { code, message: `${code} at ${path}` } } };
    markFailedNodeCall(nodeCallWatch.getStore(), error);
    return error;
  };

  freshSharedState(t);
  const warn = t.mock.method(console, "warn", () => {});
  t.mock.method(oracleHelper, "getCompletePriceMap", async () => new Map());
  t.mock.method(cirrus, "get", async (_token: string, path: string) => {
    // The mapping tables appear with their first row; a select that embeds one is refused.
    if (path === `/${constants.CollateralVault}-userCollaterals` || path === `/${constants.CDPEngine}-vaults`) {
      throw nodeError(path, 404, "42P01");
    }
    if (path === `/${constants.LendingRegistry}` || path === `/${constants.CDPRegistry}`) {
      throw nodeError(path, 400, "PGRST200");
    }

    return { data: [] };
  });

  assert.deepEqual(await getNetBalance("access-token", user), {
    netBalance: 0,
    totalBorrowed: 0,
    totalAssetValue: 0,
  });
  // Debt counted as none is said so, with the node's message.
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments[0]).sort(), [
    `Net balance: CDP tables not there yet, no debt counted: PGRST200 at /${constants.CDPRegistry}`,
    `Net balance: lending tables not there yet, no debt counted: PGRST200 at /${constants.LendingRegistry}`,
  ]);
  assert.deepEqual(await getEarningAssets("access-token", user), []);
});

test("getNetBalance fails when the lending or the CDP registry has no row, unlike a table that does not exist yet", async (t) => {
  const user = "1111111111111111111111111111111111111111";
  let registry = `/${constants.LendingRegistry}`;
  let answer: { data: unknown[] } = { data: [] };

  freshSharedState(t);
  const warn = t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(oracleHelper, "getCompletePriceMap", async () => new Map());
  t.mock.method(cirrus, "get", async (_token: string, path: string) => (path === registry ? answer : emptyWallet(path)));

  await assert.rejects(getNetBalance("access-token", user), /Error fetching LendingRegistry data from Cirrus/);

  registry = `/${constants.CDPRegistry}`;
  answer = { data: [{}] };
  await assert.rejects(getNetBalance("access-token", user), /CDP Engine not found/);
  assert.equal(warn.mock.callCount(), 0);
});
