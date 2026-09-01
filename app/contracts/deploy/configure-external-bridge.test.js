const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseArgs,
  buildPlan,
} = require("./configure-external-bridge");

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
    ["setChain", "setRoute"],
  );
  assert.deepEqual(
    actions.map((call) => call.args._func),
    ["setDepositAction"],
  );
  assert.equal(actions[0].args._args[3].value, "4");
});
