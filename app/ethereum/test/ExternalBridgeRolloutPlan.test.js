const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  collectInventory,
  buildPolicyTemplate,
  buildRolloutTemplates,
  buildSynchronizedRollout,
  validateInitialRollout,
} = require("../scripts/lib/externalBridgeRolloutPlan");
const {
  buildExpectedConfiguration,
} = require("../scripts/scanTokenConfig");

const safe = "0x1111111111111111111111111111111111111111";
const vault = "0x2222222222222222222222222222222222222222";
const router = "0x3333333333333333333333333333333333333333";
const bridge = "4444444444444444444444444444444444444444";
const usdc = "0x5555555555555555555555555555555555555555";
const usdcSt = "0x6666666666666666666666666666666666666666";
const usdst = "0x7777777777777777777777777777777777777777";

const depositPlan = {
  operations: [{
    chainId: 11155111,
    transactions: [{
      meta: {
        items: [
          {
            token: usdc,
            target: usdcSt,
            isPermitted: true,
            externalDecimals: "6",
            externalName: "USD Coin",
            externalSymbol: "USDC",
            legacyStratoMaxPerWithdrawal: "100",
            stratoTokenStatus: 2,
          },
          {
            token: usdc,
            target: usdst,
            isPermitted: true,
            externalDecimals: "6",
            externalName: "USD Coin",
            externalSymbol: "USDC",
            legacyStratoMaxPerWithdrawal: "100",
            stratoTokenStatus: 2,
          },
        ],
      },
    }],
  }],
};

const bridgeTemplate = {
  adminRegistry: "8888888888888888888888888888888888888888",
  tokenRouter: {},
  externalAssetBridge: {
    address: bridge,
    settlementVerifiers: [safe.slice(2), vault.slice(2), router.slice(2)],
  },
  chains: [{
    chainName: "sepolia",
    externalChainId: "11155111",
    vault: vault.slice(2),
    depositRouter: router.slice(2),
    enabled: true,
    lastProcessedBlock: "0",
    routes: [],
  }],
};

const vaultTemplate = {
  sourceChainId: "114784819836269",
  sourceBridge: bridge,
  chains: [{
    chainId: 11155111,
    safeAddress: safe,
    guardianAddress: safe,
    vaultAddress: vault,
    depositRouterAddress: router,
    attestationSigners: [],
    disabledAttestationSigners: [],
    attestationThreshold: 2,
    maxAuthorizationValiditySeconds: "1800",
    tokens: [],
  }],
};

const tokenKey = usdc.toLowerCase();
const policy = {
  chainId: 11155111,
  lastProcessedBlock: "1234",
  tokens: {
    [tokenKey]: {
      minDepositAmount: "1000000",
      maxPerWithdrawal: "500000000",
      manualReviewThreshold: "100000000",
      windowLimit: "1000000000",
      windowSeconds: "86400",
      maxAutoWithdrawalAmount: "100000000",
      migrateAmount: "0",
      enabled: true,
    },
  },
  routes: {
    [`${tokenKey}:${usdcSt.toLowerCase()}`]: {
      depositsEnabled: true,
      withdrawalsEnabled: false,
      rebaseRequired: false,
      autoRouteEnabled: true,
      maxAutoDepositAmount: "250000000",
    },
    [`${tokenKey}:${usdst.toLowerCase()}`]: {
      depositsEnabled: true,
      withdrawalsEnabled: false,
      rebaseRequired: false,
      autoRouteEnabled: false,
      maxAutoDepositAmount: "250000000",
    },
  },
};

const deployment = {
  network: "sepolia",
  chainId: "11155111",
  safeAddress: safe,
  guardianAddress: safe,
  depositRouterDeploymentBlock: 1234,
  externalBridgeVault: { proxy: vault },
  depositRouter: { proxy: router },
};

const settings = {
  sourceChainId: "114784819836269",
  externalDeployment: "deployment.json",
  depositPlan: "deposit-plan.json",
  tokenRouter: usdst,
  externalAssetBridge: bridge,
  bridgeOperator: safe,
  guardian: vault,
  settlementVerifiers: [safe, vault, router],
};

test("rejects enabled legacy routes with inactive STRATO tokens", () => {
  const inactivePlan = structuredClone(depositPlan);
  inactivePlan.operations[0].transactions[0].meta.items[0].stratoTokenStatus = 1;
  assert.throws(
    () => collectInventory(inactivePlan, 11155111),
    /requires an active STRATO token; status=1/,
  );

  delete inactivePlan.operations[0].transactions[0].meta.items[0]
    .stratoTokenStatus;
  assert.throws(
    () => collectInventory(inactivePlan, 11155111),
    /requires an active STRATO token; status=NOT_RECORDED/,
  );
});

test("builds one synchronized all-token rollout from DepositRouter inventory", () => {
  const rollout = buildSynchronizedRollout({
    depositPlan,
    bridgeTemplate,
    vaultTemplate,
    policy,
    chainId: 11155111,
  });

  assert.equal(rollout.summary.routeCount, 2);
  assert.equal(rollout.summary.externalTokenCount, 1);
  assert.equal(rollout.depositRouter.updates.length, 2);
  assert.equal(
    rollout.depositRouter.updates[0].minDepositAmount,
    "1000000",
  );
  assert.equal(rollout.bridgeConfig.chains[0].routes.length, 2);
  assert.equal(
    rollout.bridgeConfig.chains[0].routes[0].maxPerWithdrawal,
    "500000000",
  );
  assert.equal(rollout.vaultConfig.chains[0].tokens.length, 1);
  assert.equal(
    rollout.vaultConfig.chains[0].tokens[0].manualReviewThreshold,
    "100000000",
  );
  assert.equal(rollout.verifierPolicies.length, 3);
  assert.equal(
    rollout.verifierPolicies[0].routes[0].maxAutoDepositAmount,
    "250000000",
  );
  assert.equal(
    rollout.verifierPolicies[0].tokens[0].maxAutoWithdrawalAmount,
    "100000000",
  );
  assert.equal(
    new Set(
      rollout.verifierPolicies.map(({ baselinePolicyHash }) =>
        baselinePolicyHash,
      ),
    ).size,
    1,
  );
  assert.deepEqual(
    rollout.verifierPolicies.map(({ verifierIndex }) => verifierIndex),
    [1, 2, 3],
  );
});

test("orders route permissions so the token remains enabled when any route is enabled", () => {
  const selectivePolicy = {
    ...policy,
    routes: {
      ...policy.routes,
      [`${tokenKey}:${usdcSt.toLowerCase()}`]: {
        ...policy.routes[`${tokenKey}:${usdcSt.toLowerCase()}`],
        depositsEnabled: false,
      },
    },
  };
  const rollout = buildSynchronizedRollout({
    depositPlan,
    bridgeTemplate,
    vaultTemplate,
    policy: selectivePolicy,
    chainId: 11155111,
  });
  assert.deepEqual(
    rollout.depositRouter.updates.map((update) => update.permitted),
    [false, true],
  );
  assert.equal(
    rollout.depositRouter.updates[0].targetStratoToken,
    usdcSt,
  );
});

test("generates a fail-closed policy template for every token and route", () => {
  const inventory = collectInventory(depositPlan, 11155111);
  const generated = buildPolicyTemplate(inventory, 11155111, "1234");

  assert.equal(generated.tokens[tokenKey].maxPerWithdrawal, "REVIEW_REQUIRED");
  assert.equal(
    generated.tokens[tokenKey].maxAutoWithdrawalAmount,
    "REVIEW_REQUIRED",
  );
  assert.equal(
    generated.routes[`${tokenKey}:${usdcSt.toLowerCase()}`]
      .withdrawalsEnabled,
    false,
  );
  assert.equal(
    generated.routes[`${tokenKey}:${usdcSt.toLowerCase()}`].autoRouteEnabled,
    false,
  );
  assert.equal(
    generated.routes[`${tokenKey}:${usdcSt.toLowerCase()}`].rebaseRequired,
    "REVIEW_REQUIRED",
  );
  assert.equal(
    generated.routes[`${tokenKey}:${usdcSt.toLowerCase()}`]
      .maxAutoDepositAmount,
    "REVIEW_REQUIRED",
  );
  assert.throws(
    () =>
      buildSynchronizedRollout({
        depositPlan,
        bridgeTemplate,
        vaultTemplate,
        policy: { ...policy, routes: generated.routes },
        chainId: 11155111,
      }),
    /rebaseRequired must be boolean/,
  );
});

test("derives synchronized templates from deployment output and settings", () => {
  const generated = buildRolloutTemplates({
    settings,
    deployment,
    bridgeDefaults: bridgeTemplate,
  });

  assert.equal(generated.chainId, 11155111);
  assert.equal(generated.lastProcessedBlock, "1234");
  assert.equal(generated.bridgeTemplate.chains[0].vault, vault.slice(2));
  assert.equal(
    generated.bridgeTemplate.externalAssetBridge.settlementVerifierThreshold,
    "2",
  );
  assert.equal(generated.vaultTemplate.chains[0].safeAddress, safe);
  assert.deepEqual(generated.vaultTemplate.chains[0].attestationSigners, []);
  const existingDeployment = buildRolloutTemplates({
    settings: { ...settings, depositRouterDeploymentBlock: "11634261" },
    deployment: { ...deployment, depositRouterDeploymentBlock: undefined },
    bridgeDefaults: bridgeTemplate,
  });
  assert.equal(existingDeployment.lastProcessedBlock, "11634261");
});

test("rejects withdrawals, AUTO_ROUTE, and migration during finalization", () => {
  const baseRollout = buildSynchronizedRollout({
    depositPlan,
    bridgeTemplate,
    vaultTemplate,
    policy: {
      ...policy,
      routes: Object.fromEntries(
        Object.entries(policy.routes).map(([key, value]) => [
          key,
          { ...value, autoRouteEnabled: false },
        ]),
      ),
    },
    chainId: 11155111,
  });
  assert.equal(validateInitialRollout(baseRollout), baseRollout);
  assert.throws(
    () =>
      validateInitialRollout({
        ...baseRollout,
        summary: { ...baseRollout.summary, withdrawalsEnabledCount: 1 },
      }),
    /withdrawal route disabled/,
  );
  assert.throws(
    () =>
      validateInitialRollout({
        ...baseRollout,
        summary: { ...baseRollout.summary, autoRouteEnabledCount: 1 },
      }),
    /AUTO_ROUTE route disabled/,
  );
  assert.throws(
    () =>
      validateInitialRollout({
        ...baseRollout,
        vaultConfig: {
          ...baseRollout.vaultConfig,
          chains: [{
            ...baseRollout.vaultConfig.chains[0],
            tokens: [{
              ...baseRollout.vaultConfig.chains[0].tokens[0],
              migrateAmount: "1",
            }],
          }],
        },
      }),
    /migrateAmount at zero/,
  );
});

test("rejects missing risk policy and mismatched deployment templates", () => {
  assert.throws(
    () =>
      buildSynchronizedRollout({
        depositPlan,
        bridgeTemplate,
        vaultTemplate,
        policy: { ...policy, tokens: {} },
        chainId: 11155111,
      }),
    /Missing token policy/,
  );
  assert.throws(
    () =>
      buildSynchronizedRollout({
        depositPlan,
        bridgeTemplate,
        vaultTemplate: {
          ...vaultTemplate,
          chains: [{
            ...vaultTemplate.chains[0],
            vaultAddress: "0x9999999999999999999999999999999999999999",
          }],
        },
        policy,
        chainId: 11155111,
      }),
    /different deployments/,
  );
});

test("CLI preserves the completed policy and writes synchronized artifacts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eab-rollout-"));
  const depositPlanPath = path.join(directory, "deposit-plan.json");
  const bridgeTemplatePath = path.join(directory, "bridge-template.json");
  const vaultTemplatePath = path.join(directory, "vault-template.json");
  const policyPath = path.join(
    directory,
    "external-bridge-rollout-policy-11155111.json",
  );
  fs.writeFileSync(depositPlanPath, JSON.stringify(depositPlan));
  fs.writeFileSync(bridgeTemplatePath, JSON.stringify(bridgeTemplate));
  fs.writeFileSync(vaultTemplatePath, JSON.stringify(vaultTemplate));

  const script = path.resolve(
    __dirname,
    "../scripts/generateExternalBridgeRollout.js",
  );
  const inventoryRun = spawnSync(
    process.execPath,
    [
      script,
      "--deposit-plan",
      depositPlanPath,
      "--chain",
      "11155111",
      "--output-dir",
      directory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(inventoryRun.status, 0, inventoryRun.stderr);
  assert.equal(fs.existsSync(policyPath), true);

  fs.writeFileSync(policyPath, JSON.stringify(policy));
  const rolloutRun = spawnSync(
    process.execPath,
    [
      script,
      "--deposit-plan",
      depositPlanPath,
      "--chain",
      "11155111",
      "--bridge-template",
      bridgeTemplatePath,
      "--vault-template",
      vaultTemplatePath,
      "--policy",
      policyPath,
      "--output-dir",
      directory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(rolloutRun.status, 0, rolloutRun.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(policyPath, "utf8")), policy);
  assert.equal(
    fs.existsSync(path.join(directory, "external-bridge-11155111.json")),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(directory, "external-bridge-vault-11155111.json"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(directory, "external-bridge-verifier-policy-11155111-1.json"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(directory, "deposit-router-all-token-11155111-1.json"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(directory, "deposit-router-pause-11155111.json")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(directory, "deposit-router-unpause-11155111.json")),
    true,
  );
});

test("prepare and finalize derive templates and enforce initial policy", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eab-prepare-"));
  const depositPlanPath = path.join(directory, "deposit-plan.json");
  const deploymentPath = path.join(directory, "deployment.json");
  const settingsPath = path.join(directory, "settings.json");
  const policyPath = path.join(
    directory,
    "external-bridge-rollout-policy-11155111.json",
  );
  fs.writeFileSync(depositPlanPath, JSON.stringify(depositPlan));
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment));
  fs.writeFileSync(settingsPath, JSON.stringify(settings));

  const script = path.resolve(
    __dirname,
    "../scripts/generateExternalBridgeRollout.js",
  );
  const prepareRun = spawnSync(
    process.execPath,
    [
      script,
      "--mode",
      "prepare",
      "--settings",
      settingsPath,
      "--output-dir",
      directory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(prepareRun.status, 0, prepareRun.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(policyPath, "utf8")).lastProcessedBlock,
    "1234",
  );
  assert.equal(
    fs.existsSync(path.join(directory, "external-bridge-base-11155111.json")),
    true,
  );
  assert.equal(
    fs.existsSync(
      path.join(directory, "external-bridge-vault-base-11155111.json"),
    ),
    true,
  );
  const repeatedPrepare = spawnSync(
    process.execPath,
    [
      script,
      "--mode",
      "prepare",
      "--settings",
      settingsPath,
      "--output-dir",
      directory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(repeatedPrepare.status, 1);
  assert.match(repeatedPrepare.stderr, /Policy already exists/);

  const initialPolicy = {
    ...policy,
    routes: Object.fromEntries(
      Object.entries(policy.routes).map(([key, value]) => [
        key,
        { ...value, autoRouteEnabled: false },
      ]),
    ),
  };
  fs.writeFileSync(policyPath, JSON.stringify(initialPolicy));
  const finalizeRun = spawnSync(
    process.execPath,
    [
      script,
      "--mode",
      "finalize",
      "--settings",
      settingsPath,
      "--policy",
      policyPath,
      "--output-dir",
      directory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(finalizeRun.status, 0, finalizeRun.stderr);
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(directory, "external-bridge-rollout-manifest-11155111.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.summary.routeCount, 2);
  assert.equal(manifest.summary.withdrawalsEnabledCount, 0);
  assert.equal(manifest.summary.autoRouteEnabledCount, 0);
  assert.equal(manifest.sourceSettings, settingsPath);
  const expected = buildExpectedConfiguration(manifest, directory);
  assert.equal(expected.depositRouterAddress, router);
  assert.equal(expected.ownerAddress, safe);
  assert.equal(expected.vaultAddress, vault);
  assert.equal(expected.routes.size, 2);
  assert.equal(expected.tokens.get(tokenKey).permitted, true);
});
