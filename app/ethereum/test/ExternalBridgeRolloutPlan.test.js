const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  collectInventory,
  buildPolicyTemplate,
  buildSynchronizedRollout,
} = require("../scripts/lib/externalBridgeRolloutPlan");

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
          },
          {
            token: usdc,
            target: usdst,
            isPermitted: true,
            externalDecimals: "6",
            externalName: "USD Coin",
            externalSymbol: "USDC",
            legacyStratoMaxPerWithdrawal: "100",
          },
        ],
      },
    }],
  }],
};

const bridgeTemplate = {
  adminRegistry: "8888888888888888888888888888888888888888",
  tokenRouter: {},
  externalAssetBridge: { address: bridge },
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
    },
    [`${tokenKey}:${usdst.toLowerCase()}`]: {
      depositsEnabled: true,
      withdrawalsEnabled: false,
      rebaseRequired: false,
      autoRouteEnabled: false,
    },
  },
};

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
});

test("generates a fail-closed policy template for every token and route", () => {
  const inventory = collectInventory(depositPlan, 11155111);
  const generated = buildPolicyTemplate(inventory, 11155111);

  assert.equal(generated.tokens[tokenKey].maxPerWithdrawal, "REVIEW_REQUIRED");
  assert.equal(
    generated.routes[`${tokenKey}:${usdcSt.toLowerCase()}`]
      .withdrawalsEnabled,
    false,
  );
  assert.equal(
    generated.routes[`${tokenKey}:${usdcSt.toLowerCase()}`].autoRouteEnabled,
    false,
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
