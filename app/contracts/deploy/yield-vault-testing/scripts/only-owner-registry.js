"use strict";

const CONTRACT_METHODS = Object.freeze({
  Token: Object.freeze({
    mint: ["to", "amount"],
  }),
  YieldVaultOld: Object.freeze({
    initialize: ["asset_", "name_", "symbol_"],
    setMinIdleBps: ["minIdleBps_"],
    setStrategyApproval: ["strategy", "approved"],
    deployCapital: ["to", "assets"],
    returnCapital: ["from", "assets"],
    reportStrategyLoss: ["strategy", "loss"],
    processQueue: ["maxRequests", "maxAssets"],
    pause: [],
    unpause: [],
  }),
  YieldVault: Object.freeze({
    initializeAccrual: [],
    setStrategyApproval: ["strategy", "approved"],
    setMinIdleBps: ["minIdleBps_"],
    accrue: [],
    setPerSecondSavingsRate: ["newRate"],
    setRewardDistributor: ["newRewardDistributor"],
    deployCapital: ["to", "assets"],
    returnCapital: ["from", "assets"],
    reportStrategyLoss: ["strategy", "loss"],
    processQueue: ["maxRequests", "maxAssets"],
    pause: [],
    unpause: [],
  }),
  Proxy: Object.freeze({
    setLogicContract: ["_logicContract"],
  }),
  User: Object.freeze({
    createContract: ["contractName", "contractSrc", "args"],
  }),
});

const CHECKPOINTS = Object.freeze({
  funding: Object.freeze({
    pattern: "mint-<plan index>",
    entries: Object.freeze([{ checkpoint: "mint-*", contract: "Token", method: "mint" }]),
  }),
  seed: Object.freeze({
    entries: Object.freeze([
      { checkpoint: "100", contract: "YieldVaultOld", method: "initialize" },
      { checkpoint: "130", contract: "YieldVaultOld", method: "setMinIdleBps" },
      { checkpoint: "131", contract: "YieldVaultOld", method: "setStrategyApproval" },
      { checkpoint: "140", contract: "YieldVaultOld", method: "deployCapital" },
      { checkpoint: "152", contract: "YieldVaultOld", method: "returnCapital" },
      { checkpoint: "160", contract: "YieldVaultOld", method: "deployCapital" },
      { checkpoint: "171", contract: "YieldVaultOld", method: "reportStrategyLoss" },
      { checkpoint: "182", contract: "YieldVaultOld", method: "processQueue" },
    ]),
  }),
  e2e: Object.freeze({
    entries: Object.freeze([
      { checkpoint: "202", contract: "YieldVault", method: "returnCapital" },
      { checkpoint: "210", contract: "YieldVault", method: "deployCapital" },
      { checkpoint: "212", contract: "YieldVault", method: "reportStrategyLoss" },
      { checkpoint: "213", contract: "YieldVault", method: "returnCapital" },
      { checkpoint: "400", contract: "YieldVault", method: "setPerSecondSavingsRate" },
      { checkpoint: "410", contract: "YieldVault", method: "accrue" },
      { checkpoint: "411", contract: "YieldVault", method: "setPerSecondSavingsRate" },
      { checkpoint: "600", contract: "YieldVault", method: "deployCapital" },
      { checkpoint: "602", contract: "YieldVault", method: "processQueue" },
      { checkpoint: "605", contract: "YieldVault", method: "returnCapital" },
      { checkpoint: "606", contract: "YieldVault", method: "processQueue" },
    ]),
  }),
  localUpgrade: Object.freeze({
    entries: Object.freeze([
      { checkpoint: "deploy-proxy", contract: "User", method: "createContract" },
      { checkpoint: "deploy-old-implementation", contract: "User", method: "createContract" },
      { checkpoint: "deploy-new-implementation", contract: "User", method: "createContract" },
      { checkpoint: "activate-old-implementation", contract: "Proxy", method: "setLogicContract" },
      { checkpoint: "upgrade-pointer", contract: "Proxy", method: "setLogicContract" },
      { checkpoint: "rollback-pointer", contract: "Proxy", method: "setLogicContract" },
    ]),
  }),
  manualRunbook: Object.freeze({
    entries: Object.freeze([
      { checkpoint: "pause", contract: "YieldVault", method: "pause" },
      { checkpoint: "initializeAccrual", contract: "YieldVault", method: "initializeAccrual" },
      { checkpoint: "initializeAccrualRepeat", contract: "YieldVault", method: "initializeAccrual" },
      { checkpoint: "setRewardDistributor", contract: "YieldVault", method: "setRewardDistributor" },
      {
        checkpoint: "setPerSecondSavingsRate",
        contract: "YieldVault",
        method: "setPerSecondSavingsRate",
      },
      { checkpoint: "unpause", contract: "YieldVault", method: "unpause" },
      { checkpoint: "smokeProcessQueue", contract: "YieldVault", method: "processQueue" },
    ]),
  }),
});

function argumentOrder(contract, method) {
  const methods = CONTRACT_METHODS[contract];
  return methods && Object.prototype.hasOwnProperty.call(methods, method)
    ? methods[method]
    : null;
}

function isOnlyOwner(contract, method) {
  return argumentOrder(contract, method) !== null;
}

function positionalArguments(contract, method, args = {}) {
  const order = argumentOrder(contract, method);
  if (!order) throw new Error(`Unregistered onlyOwner operation ${contract}.${method}`);
  const unexpected = Object.keys(args).filter((name) => !order.includes(name));
  const missing = order.filter((name) => args[name] == null);
  if (unexpected.length || missing.length) {
    throw new Error(
      `${contract}.${method} arguments must exactly match ${order.join(",") || "(none)"}`
    );
  }
  return order.map((name) => args[name]);
}

function assertMarkedOnlyOwner(spec, label = spec && spec.name || "transaction") {
  const registered = isOnlyOwner(spec.registryContract, spec.method);
  if (registered && (spec.onlyOwner !== true || spec.governed !== true)) {
    throw new Error(`${label} is registered onlyOwner but is not explicitly marked governed`);
  }
  if (!registered && (spec.onlyOwner === true || spec.governed === true)) {
    throw new Error(`${label} is marked onlyOwner/governed but is not registered`);
  }
  return registered;
}

function registeredCheckpoint(scope, checkpoint, contract, method) {
  const entries = CHECKPOINTS[scope] && CHECKPOINTS[scope].entries || [];
  return entries.some((entry) =>
    (entry.checkpoint === checkpoint ||
      entry.checkpoint.endsWith("*") && checkpoint.startsWith(entry.checkpoint.slice(0, -1))) &&
    entry.contract === contract &&
    entry.method === method);
}

module.exports = {
  CHECKPOINTS,
  CONTRACT_METHODS,
  argumentOrder,
  assertMarkedOnlyOwner,
  isOnlyOwner,
  positionalArguments,
  registeredCheckpoint,
};
