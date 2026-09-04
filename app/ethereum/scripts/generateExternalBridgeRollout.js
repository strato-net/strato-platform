const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const {
  encodeCall,
  chunkArray,
  buildTransactionBuilderBatch,
} = require("./lib/depositRouterSafeOps");
const {
  collectInventory,
  buildPolicyTemplate,
  buildSynchronizedRollout,
} = require("./lib/externalBridgeRolloutPlan");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  const allowed = new Set([
    "deposit-plan",
    "bridge-template",
    "vault-template",
    "policy",
    "chain",
    "output-dir",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--") || !allowed.has(item.slice(2))) {
      throw new Error(`Unsupported option ${item}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${item}`);
    }
    args[item.slice(2)] = value;
    index += 1;
  }
  for (const required of ["deposit-plan", "chain", "output-dir"]) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const chainId = Number(args.chain);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("--chain must be a positive safe integer");
  }
  return { ...args, chainId };
}

const readJson = (file, label) => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
};

const writeJson = (directory, name, value) => {
  const outputPath = path.join(directory, name);
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
  return outputPath;
};

function buildDepositRouterBatches(rollout) {
  return chunkArray(rollout.depositRouter.updates, 20).map((updates, index) => {
    const transaction = {
      to: rollout.depositRouter.address,
      value: "0",
      data: encodeCall("batchUpdateTokens", [
        updates.map(({ token }) => ethers.getAddress(token)),
        updates.map(({ minDepositAmount }) => minDepositAmount),
        updates.map(({ permitted }) => permitted),
        updates.map(({ targetStratoToken }) =>
          ethers.getAddress(targetStratoToken),
        ),
      ]),
      operation: 0,
    };
    return {
      index: index + 1,
      updates,
      transactionBuilder: buildTransactionBuilderBatch(
        rollout.chainId,
        rollout.depositRouter.safeAddress,
        [transaction],
        {
          name: `EAB all-token DepositRouter batch ${index + 1}`,
          description: `${updates.length} synchronized token route updates`,
        },
      ),
    };
  });
}

function buildDepositRouterControl(rollout, action) {
  if (!["pause", "unpause"].includes(action)) {
    throw new Error(`Unsupported DepositRouter control action: ${action}`);
  }
  return buildTransactionBuilderBatch(
    rollout.chainId,
    rollout.depositRouter.safeAddress,
    [{
      to: rollout.depositRouter.address,
      value: "0",
      data: encodeCall(action, []),
      operation: 0,
    }],
    {
      name: `EAB DepositRouter ${action} (${rollout.chainId})`,
      description: `${action} the new DepositRouter through Safe`,
    },
  );
}

function main() {
  const args = parseArgs();
  const outputDirectory = path.resolve(args["output-dir"]);
  fs.mkdirSync(outputDirectory, { recursive: true });

  const depositPlan = readJson(args["deposit-plan"], "DepositRouter plan");
  const inventory = collectInventory(depositPlan, args.chainId);

  if (!args.policy) {
    const policyPath = writeJson(
      outputDirectory,
      `external-bridge-rollout-policy-${args.chainId}.json`,
      buildPolicyTemplate(inventory, args.chainId),
    );
    const inventoryPath = writeJson(
      outputDirectory,
      `external-bridge-inventory-${args.chainId}.json`,
      inventory,
    );
    console.log(
      JSON.stringify(
        {
          mode: "inventory",
          chainId: args.chainId,
          routeCount: inventory.length,
          inventoryPath,
          policyPath,
          next: "Fill every REVIEW_REQUIRED policy value, then rerun with --policy, --bridge-template, and --vault-template.",
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const required of ["bridge-template", "vault-template"]) {
    if (!args[required]) {
      throw new Error(`--${required} is required when --policy is provided`);
    }
  }
  const rollout = buildSynchronizedRollout({
    depositPlan,
    bridgeTemplate: readJson(
      args["bridge-template"],
      "ExternalAssetBridge template",
    ),
    vaultTemplate: readJson(
      args["vault-template"],
      "ExternalBridgeVault template",
    ),
    policy: readJson(args.policy, "rollout policy"),
    chainId: args.chainId,
  });
  const bridgeConfigPath = writeJson(
    outputDirectory,
    `external-bridge-${args.chainId}.json`,
    rollout.bridgeConfig,
  );
  const vaultConfigPath = writeJson(
    outputDirectory,
    `external-bridge-vault-${args.chainId}.json`,
    rollout.vaultConfig,
  );
  const batches = buildDepositRouterBatches(rollout);
  const depositRouterPausePath = writeJson(
    outputDirectory,
    `deposit-router-pause-${args.chainId}.json`,
    buildDepositRouterControl(rollout, "pause"),
  );
  const depositRouterBatchPaths = batches.map(({ index, transactionBuilder }) =>
    writeJson(
      outputDirectory,
      `deposit-router-all-token-${args.chainId}-${index}.json`,
      transactionBuilder,
    ),
  );
  const depositRouterUnpausePath = writeJson(
    outputDirectory,
    `deposit-router-unpause-${args.chainId}.json`,
    buildDepositRouterControl(rollout, "unpause"),
  );
  const manifestPath = writeJson(
    outputDirectory,
    `external-bridge-rollout-manifest-${args.chainId}.json`,
    {
      generatedAt: new Date().toISOString(),
      chainId: args.chainId,
      sourceDepositPlan: path.resolve(args["deposit-plan"]),
      sourcePolicy: path.resolve(args.policy),
      summary: rollout.summary,
      inventory: rollout.inventory,
      depositRouterUpdates: rollout.depositRouter.updates,
      outputs: {
        bridgeConfigPath,
        vaultConfigPath,
        depositRouterPausePath,
        depositRouterBatchPaths,
        depositRouterUnpausePath,
      },
    },
  );
  console.log(
    JSON.stringify(
      {
        mode: "rollout",
        chainId: args.chainId,
        ...rollout.summary,
        bridgeConfigPath,
        vaultConfigPath,
        depositRouterPausePath,
        depositRouterBatchPaths,
        depositRouterUnpausePath,
        manifestPath,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`generateExternalBridgeRollout failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  buildDepositRouterBatches,
  buildDepositRouterControl,
};
