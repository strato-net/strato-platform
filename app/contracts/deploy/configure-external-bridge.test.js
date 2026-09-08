const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseArgs,
  buildPlan,
} = require("./configure-external-bridge");
const {
  compareInitialization,
  compareRoutes,
  compareActions,
  verifyConfiguration,
} = require("./external-bridge-verification");

const ADDRESS = "1".repeat(40);

const settings = {
  adminRegistry: "2".repeat(40),
  tokenRouter: {
    address: "3".repeat(40),
    poolFactory: ADDRESS,
    poolV3Factory: ADDRESS,
    directMintPsm: ADDRESS,
    metalForge: ADDRESS,
    saveUsdstVault: ADDRESS,
    yieldVaults: ["4".repeat(40), "5".repeat(40)],
  },
  bridge: {
    address: "6".repeat(40),
    tokenFactory: ADDRESS,
    bridgeOperator: ADDRESS,
    guardian: ADDRESS,
    usdst: ADDRESS,
    priceOracle: ADDRESS,
    settlementVerifiers: [
      "a".repeat(40),
      "b".repeat(40),
      "c".repeat(40),
    ],
    settlementVerifierThreshold: "2",
  },
  chains: [{
    chainName: "sepolia",
    vault: "7".repeat(40),
    depositRouter: "8".repeat(40),
    enabled: true,
    externalChainId: "11155111",
    lastProcessedBlock: "1",
    routes: [{
      externalToken: "0".repeat(40),
      stratoToken: "9".repeat(40),
      depositsEnabled: true,
      withdrawalsEnabled: true,
      externalDecimals: "18",
      externalName: "Ether",
      externalSymbol: "ETH",
      maxPerWithdrawal: "10",
      manualReviewThreshold: "5",
      rebaseRequired: false,
      autoRouteEnabled: true,
    }],
  }],
};

test("parses an explicit dry-run step", () => {
  assert.deepEqual(
    parseArgs(["--config", "setup.json", "--step", "routes"]),
    { execute: false, config: "setup.json", step: "routes" },
  );
  assert.deepEqual(
    parseArgs(["--config", "setup.json", "--step", "verify-initialize"]),
    { execute: false, config: "setup.json", step: "verify-initialize" },
  );
  assert.deepEqual(
    parseArgs(["--config", "setup.json", "--step", "verify-actions"]),
    { execute: false, config: "setup.json", step: "verify-actions" },
  );
  assert.throws(
    () =>
      parseArgs([
        "--config",
        "setup.json",
        "--step",
        "verify-routes",
        "--execute",
      ]),
    /not valid for verification/,
  );
});

test("builds initialization votes including every yield vault", () => {
  const plan = buildPlan(settings, "initialize");
  assert.deepEqual(
    plan.map((call) => call.args._func),
    [
      "initialize",
      "setYieldVault",
      "setYieldVault",
      "initialize",
      "setPriceOracle",
      "setTokenRouter",
      "setSettlementVerifier",
      "setSettlementVerifier",
      "setSettlementVerifier",
      "setSettlementVerifierThreshold",
    ],
  );
});

test("keeps action enablement in a separate plan", () => {
  const routes = buildPlan(settings, "routes");
  const actions = buildPlan(settings, "actions");
  assert.deepEqual(
    routes.map((call) => call.args._func),
    ["setChain", "setRoute", "setRouteRebaseRequired"],
  );
  assert.equal(routes[2].args._args[3].value, false);
  assert.deepEqual(
    actions.map((call) => call.args._func),
    ["setDepositAction"],
  );
  assert.equal(actions[0].args._args[3].value, "4");
  assert.equal(actions[0].args._args[4].value, true);

  const disabledSettings = structuredClone(settings);
  disabledSettings.chains[0].routes[0].autoRouteEnabled = false;
  assert.equal(
    buildPlan(disabledSettings, "actions")[0].args._args[4].value,
    false,
  );
});

test("verifies initialized bridge and TokenRouter state", () => {
  const state = {
    tokenRouter: {
      initialized: true,
      poolFactory: ADDRESS,
      poolV3Factory: ADDRESS,
      directMintPsm: ADDRESS,
      metalForge: ADDRESS,
      saveUsdstVault: ADDRESS,
    },
    approvedYieldVaults: new Set([
      "4".repeat(40),
      "5".repeat(40),
    ]),
    bridge: {
      initialized: true,
      tokenFactory: ADDRESS,
      bridgeOperator: ADDRESS,
      guardian: ADDRESS,
      USDST_ADDRESS: ADDRESS,
      priceOracle: ADDRESS,
      tokenRouter: "3".repeat(40),
      settlementVerifierCount: "3",
      settlementVerifierThreshold: "2",
    },
    settlementVerifiers: new Set([
      "a".repeat(40),
      "b".repeat(40),
      "c".repeat(40),
    ]),
  };
  assert.deepEqual(compareInitialization(settings, state), []);
  state.bridge.settlementVerifierCount = "2";
  assert.match(compareInitialization(settings, state)[0], /count must be 3/);
});

test("verifies chains, routes, and rebase policy independently of actions", () => {
  const route = settings.chains[0].routes[0];
  const key = `${route.externalToken}:11155111:${route.stratoToken}`;
  const state = {
    chains: new Map([
      ["11155111", {
        chainName: "sepolia",
        vault: "7".repeat(40),
        depositRouter: "8".repeat(40),
        enabled: true,
        lastProcessedBlock: "1",
      }],
    ]),
    routes: new Map([[key, {
      depositsEnabled: true,
      withdrawalsEnabled: true,
      externalDecimals: "18",
      externalName: "Ether",
      externalSymbol: "ETH",
      maxPerWithdrawal: "10",
      manualReviewThreshold: "5",
    }]]),
    rebaseRequired: new Set(),
  };
  assert.deepEqual(compareRoutes(settings, state), []);
});

test("verifies configured actions and rejects unexpected actions", () => {
  const route = settings.chains[0].routes[0];
  const key = `${route.externalToken}:11155111:${route.stratoToken}`;
  const state = {
    actionConfigs: new Map([
      [key, { autoForge: false, autoSave: false, autoRoute: true }],
    ]),
  };
  assert.deepEqual(compareActions(settings, state), []);

  state.actionConfigs.set(key, {
    autoForge: true,
    autoSave: true,
    autoRoute: false,
  });
  assert.match(
    compareActions(settings, state).join("\n"),
    /AUTO_ROUTE mismatch.*Unexpected AUTO_SAVE.*Unexpected AUTO_FORGE/s,
  );

  state.actionConfigs.set(
    `${"f".repeat(40)}:11155111:${"e".repeat(40)}`,
    { autoRoute: true },
  );
  assert.match(
    compareActions(settings, state).join("\n"),
    /Unexpected enabled deposit action/,
  );
});

test("loads verification state from Cirrus", async () => {
  const response = (body) => ({
    ok: true,
    json: async () => body,
  });
  let actionsEnabled = false;
  const fetchImpl = async (url) => {
    if (url.includes("ExternalAssetBridge-settlementVerifiers")) {
      return response([
        { key: "a".repeat(40) },
        { key: "b".repeat(40) },
        { key: "c".repeat(40) },
      ]);
    }
    if (url.includes("TokenRouter-approvedYieldVaults")) {
      return response([
        { key: "4".repeat(40) },
        { key: "5".repeat(40) },
      ]);
    }
    if (url.includes("ExternalAssetBridge-chains")) {
      return response([{
        key: "11155111",
        value: {
          chainName: "sepolia",
          vault: "7".repeat(40),
          depositRouter: "8".repeat(40),
          enabled: true,
          lastProcessedBlock: "1",
        },
      }]);
    }
    if (url.includes("ExternalAssetBridge-routes")) {
      return response([{
        key: "0".repeat(40),
        key2: "11155111",
        key3: "9".repeat(40),
        value: {
          depositsEnabled: true,
          withdrawalsEnabled: true,
          externalDecimals: "18",
          externalName: "Ether",
          externalSymbol: "ETH",
          maxPerWithdrawal: "10",
          manualReviewThreshold: "5",
        },
      }]);
    }
    if (url.includes("routeRebaseRequired")) {
      return response([]);
    }
    if (url.includes("depositActionConfigs")) {
      return response(
        actionsEnabled
          ? [{
              key: "0".repeat(40),
              key2: "11155111",
              key3: "9".repeat(40),
              value: {
                autoForge: false,
                autoSave: false,
                autoRoute: true,
              },
            }]
          : [],
      );
    }
    if (url.includes("BlockApps-ExternalAssetBridge?")) {
      return response([{
        initialized: true,
        tokenFactory: ADDRESS,
        bridgeOperator: ADDRESS,
        guardian: ADDRESS,
        USDST_ADDRESS: ADDRESS,
        priceOracle: ADDRESS,
        tokenRouter: "3".repeat(40),
        settlementVerifierCount: "3",
        settlementVerifierThreshold: "2",
      }]);
    }
    if (url.includes("BlockApps-TokenRouter?")) {
      return response([{
        initialized: true,
        poolFactory: ADDRESS,
        poolV3Factory: ADDRESS,
        directMintPsm: ADDRESS,
        metalForge: ADDRESS,
        saveUsdstVault: ADDRESS,
      }]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.equal(
    (
      await verifyConfiguration(settings, "verify-initialize", {
        nodeUrl: "https://strato.example",
        token: "token",
        fetchImpl,
      })
    ).status,
    "PASSED",
  );
  assert.equal(
    (
      await verifyConfiguration(settings, "verify-routes", {
        nodeUrl: "https://strato.example",
        token: "token",
        fetchImpl,
      })
    ).status,
    "PASSED",
  );
  actionsEnabled = true;
  assert.equal(
    (
      await verifyConfiguration(settings, "verify-actions", {
        nodeUrl: "https://strato.example",
        token: "token",
        fetchImpl,
      })
    ).status,
    "PASSED",
  );
});
