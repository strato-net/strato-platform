const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  parseArgs,
  buildPlan,
  selectPlanCalls,
  writeOutput,
} = require("./configure-external-bridge");
const {
  requiredRoutePermissions,
  validateRoutePermissions,
  compareInitialization,
  compareRoutes,
  compareActions,
  validateActiveRouteTokens,
  validateDeploymentDependencies,
  verifyConfiguration,
} = require("./external-bridge-verification");

const ADDRESS = "1".repeat(40);

const settings = {
  sourceChainId: "114784819836269",
  mintPolicies: [{ token: "9".repeat(40), capacity: "1000", refillRate: "1" }],
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
  assert.deepEqual(
    parseArgs([
      "--config",
      "setup.json",
      "--step",
      "routes",
      "--start-call",
      "4",
      "--output-dir",
      "/secure/eab",
    ]),
    {
      execute: false,
      config: "setup.json",
      step: "routes",
      "start-call": "4",
      "output-dir": "/secure/eab",
    },
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
  assert.throws(
    () =>
      parseArgs([
        "--config",
        "setup.json",
        "--step",
        "verify-routes",
        "--start-call",
        "1",
      ]),
    /--start-call must be a positive integer/,
  );
});

test("selects a one-based governance resume point", () => {
  const plan = buildPlan(settings, "routes");
  const selected = selectPlanCalls(plan, "2");
  assert.equal(selected.firstCall, 2);
  assert.deepEqual(selected.calls, plan.slice(1));
  assert.throws(
    () => selectPlanCalls(plan, String(plan.length + 1)),
    /must be between 1 and/,
  );
});

test("writes governance output to the requested directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eab-governance-"));
  const outputPath = writeOutput({ step: "verify-actions" }, directory);
  assert.equal(path.dirname(outputPath), directory);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).step, "verify-actions");
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
    ["setMintPolicy", "addWhitelist", "addWhitelist", "setChain", "setRoute", "setRouteRebaseRequired"],
  );
  assert.equal(routes[5].args._args[3].value, false);
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
    mintPolicies: new Map(settings.mintPolicies.map((policy) => [policy.token, policy])),
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

test("rejects inactive STRATO tokens before route voting", async () => {
  const errors = await validateActiveRouteTokens(
    settings,
    "https://strato.example",
    "token",
    async () => ({
      ok: true,
      json: async () => [{
        address: settings.chains[0].routes[0].stratoToken,
        status: 1,
        _symbol: "ETH",
      }],
    }),
  );
  assert.deepEqual(errors, [
    `${settings.chains[0].routes[0].stratoToken} (ETH): status=1`,
  ]);
});

test("loads verification state from Cirrus", async () => {
  const response = (body) => ({
    ok: true,
    json: async () => body,
  });
  let actionsEnabled = false;
  const fetchImpl = async (url) => {
    if (url.includes("/eth/v1.2/metadata")) return response({ networkID: settings.sourceChainId });
    if (/BlockApps-(TokenFactory|PriceOracle|Token)\?/.test(url)) return response([{ address: ADDRESS, status: 2, _symbol: "USDST", tokenFactory: ADDRESS }]);
    if (url.includes("ExternalAssetBridge-mintPolicies")) return response(settings.mintPolicies.map((policy) => ({ key: policy.token, value: policy })));
    if (url.includes("AdminRegistry-whitelist")) {
      return response(["mint", "burn"].map((func) => ({
        key: "9".repeat(40), key2: func, key3: settings.bridge.address, value: true,
      })));
    }
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


test("grants only required token permissions before enabling routes, without duplicates", () => {
  const input = structuredClone(settings);
  input.chains.push(structuredClone(input.chains[0]));
  const plan = buildPlan(input, "routes");
  const grants = plan.filter((call) => call.args._func === "addWhitelist");
  assert.equal(grants.length, 2);
  for (const [index, func] of ["mint", "burn"].entries()) {
    assert.deepEqual(grants[index], {
      contract: settings.adminRegistry, method: "castVoteOnIssue",
      args: {
        _target: settings.adminRegistry, _func: "addWhitelist",
        _args: [
          { type: "address", value: "9".repeat(40) },
          { type: "string", value: func },
          { type: "address", value: settings.bridge.address },
        ],
      },
    });
  }
  for (const chain of input.chains) chain.routes[0].withdrawalsEnabled = false;
  assert.deepEqual(requiredRoutePermissions(input), [{ token: "9".repeat(40), func: "mint" }]);
  for (const chain of input.chains) chain.routes[0].depositsEnabled = false;
  assert.deepEqual(requiredRoutePermissions(input), []);
});

test("rejects missing, revoked, or wrong-caller token permissions", async () => {
  let rows = [];
  const check = () => validateRoutePermissions(settings, "https://strato.example", "token", async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("address"), `eq.${settings.adminRegistry}`);
    assert.equal(params.get("key3"), `eq.${settings.bridge.address}`);
    assert.equal(params.get("key2"), "in.(mint,burn)");
    return { ok: true, json: async () => rows };
  });
  assert.equal((await check()).length, 2);
  rows = ["mint", "burn"].map((func) => ({
    key: "9".repeat(40), key2: func, key3: settings.bridge.address, value: true,
  }));
  assert.deepEqual(await check(), []);
  rows[0].value = false;
  assert.match((await check())[0], /Missing bridge mint permission/);
  rows[0].value = true;
  rows[0].key3 = ADDRESS;
  assert.match((await check())[0], /Missing bridge mint permission/);
});

test("validates deployment dependencies independently of generated bridge state", async () => {
  let networkID = settings.sourceChainId;
  let tokenFactory = ADDRESS;
  let missingOracle = false;
  const read = async (url) => ({ ok: true, json: async () => {
    if (url.endsWith("/metadata")) return { networkID };
    if (url.includes("BlockApps-PriceOracle") && missingOracle) return [];
    return [{ address: ADDRESS, status: 2, _symbol: "USDST", tokenFactory }];
  } });
  await validateDeploymentDependencies(settings, "https://strato.example", "token", read);
  networkID = "1";
  await assert.rejects(validateDeploymentDependencies(settings, "https://strato.example", "token", read), /chain ID mismatch/);
  networkID = settings.sourceChainId;
  tokenFactory = "f".repeat(40);
  await assert.rejects(validateDeploymentDependencies(settings, "https://strato.example", "token", read), /USDST dependency/);
  tokenFactory = ADDRESS;
  missingOracle = true;
  await assert.rejects(validateDeploymentDependencies(settings, "https://strato.example", "token", read), /PriceOracle dependency/);
});
