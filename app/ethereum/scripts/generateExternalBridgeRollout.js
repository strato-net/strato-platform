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
  buildRolloutTemplates,
  buildSynchronizedRollout,
  validateInitialRollout,
} = require("./lib/externalBridgeRolloutPlan");

const BRIDGE_DEFAULTS_PATH = path.resolve(
  __dirname,
  "../../contracts/deploy/external-bridge.helium.example.json",
);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  const allowed = new Set([
    "mode",
    "settings",
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
  const mode = args.mode || "generate";
  if (!["generate", "prepare", "finalize"].includes(mode)) {
    throw new Error("--mode must be generate|prepare|finalize");
  }
  const requiredArgs =
    mode === "generate"
      ? ["deposit-plan", "chain", "output-dir"]
      : mode === "prepare"
        ? ["settings", "output-dir"]
        : ["settings", "policy", "output-dir"];
  for (const required of requiredArgs) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  if (mode === "generate") {
    const chainId = Number(args.chain);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error("--chain must be a positive safe integer");
    }
    return { ...args, mode, chainId };
  }
  return { ...args, mode };
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
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
  fs.renameSync(temporaryPath, outputPath);
  return outputPath;
};

const resolveFrom = (directory, file) =>
  path.resolve(directory, String(file || ""));

function loadSettingsInputs(settingsPath) {
  const absoluteSettingsPath = path.resolve(settingsPath);
  const settings = readJson(absoluteSettingsPath, "rollout settings");
  const settingsDirectory = path.dirname(absoluteSettingsPath);
  for (const required of ["externalDeployment", "depositPlan"]) {
    if (!settings[required]) {
      throw new Error(`Rollout settings require ${required}`);
    }
  }
  const deploymentPath = resolveFrom(
    settingsDirectory,
    settings.externalDeployment,
  );
  const depositPlanPath = resolveFrom(settingsDirectory, settings.depositPlan);
  const templates = buildRolloutTemplates({
    settings,
    deployment: readJson(deploymentPath, "external deployment"),
    bridgeDefaults: readJson(
      BRIDGE_DEFAULTS_PATH,
      "Helium ExternalAssetBridge defaults",
    ),
  });
  return {
    depositPlanPath,
    depositPlan: readJson(depositPlanPath, "DepositRouter plan"),
    ...templates,
  };
}

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

  if (args.mode === "prepare") {
    const inputs = loadSettingsInputs(args.settings);
    const inventory = collectInventory(inputs.depositPlan, inputs.chainId);
    const policyName =
      `external-bridge-rollout-policy-${inputs.chainId}.json`;
    const policyPath = path.join(outputDirectory, policyName);
    if (fs.existsSync(policyPath)) {
      throw new Error(
        `Policy already exists and was not overwritten: ${policyPath}`,
      );
    }
    const bridgeTemplatePath = writeJson(
      outputDirectory,
      `external-bridge-base-${inputs.chainId}.json`,
      inputs.bridgeTemplate,
    );
    const vaultTemplatePath = writeJson(
      outputDirectory,
      `external-bridge-vault-base-${inputs.chainId}.json`,
      inputs.vaultTemplate,
    );
    writeJson(
      outputDirectory,
      policyName,
      buildPolicyTemplate(
        inventory,
        inputs.chainId,
        inputs.lastProcessedBlock,
      ),
    );
    const inventoryPath = writeJson(
      outputDirectory,
      `external-bridge-inventory-${inputs.chainId}.json`,
      inventory,
    );
    console.log(
      JSON.stringify(
        {
          mode: "prepare",
          chainId: inputs.chainId,
          routeCount: inventory.length,
          bridgeTemplatePath,
          vaultTemplatePath,
          inventoryPath,
          policyPath,
          next: "Fill every REVIEW_REQUIRED policy value, then run external:rollout:finalize.",
        },
        null,
        2,
      ),
    );
    return;
  }

  let chainId;
  let depositPlan;
  let depositPlanPath;
  let bridgeTemplate;
  let vaultTemplate;
  if (args.mode === "finalize") {
    const inputs = loadSettingsInputs(args.settings);
    chainId = inputs.chainId;
    depositPlan = inputs.depositPlan;
    depositPlanPath = inputs.depositPlanPath;
    bridgeTemplate = inputs.bridgeTemplate;
    vaultTemplate = inputs.vaultTemplate;
  } else {
    chainId = args.chainId;
    depositPlanPath = path.resolve(args["deposit-plan"]);
    depositPlan = readJson(depositPlanPath, "DepositRouter plan");
  }

  const inventory = collectInventory(depositPlan, chainId);
  if (!args.policy) {
    const policyPath = writeJson(
      outputDirectory,
      `external-bridge-rollout-policy-${chainId}.json`,
      buildPolicyTemplate(inventory, chainId),
    );
    const inventoryPath = writeJson(
      outputDirectory,
      `external-bridge-inventory-${chainId}.json`,
      inventory,
    );
    console.log(
      JSON.stringify(
        {
          mode: "inventory",
          chainId,
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

  if (args.mode === "generate") {
    for (const required of ["bridge-template", "vault-template"]) {
      if (!args[required]) {
        throw new Error(`--${required} is required when --policy is provided`);
      }
    }
    bridgeTemplate = readJson(
      args["bridge-template"],
      "ExternalAssetBridge template",
    );
    vaultTemplate = readJson(
      args["vault-template"],
      "ExternalBridgeVault template",
    );
  }
  const rollout = buildSynchronizedRollout({
    depositPlan,
    bridgeTemplate,
    vaultTemplate,
    policy: readJson(args.policy, "rollout policy"),
    chainId,
  });
  if (args.mode === "finalize") validateInitialRollout(rollout);
  const bridgeConfigPath = writeJson(
    outputDirectory,
    `external-bridge-${chainId}.json`,
    rollout.bridgeConfig,
  );
  const vaultConfigPath = writeJson(
    outputDirectory,
    `external-bridge-vault-${chainId}.json`,
    rollout.vaultConfig,
  );
  const verifierPolicyPaths = rollout.verifierPolicies.map(
    (verifierPolicy, index) =>
      writeJson(
        outputDirectory,
        `external-bridge-verifier-policy-${chainId}-${index + 1}.json`,
        verifierPolicy,
      ),
  );
  const batches = buildDepositRouterBatches(rollout);
  const depositRouterPausePath = writeJson(
    outputDirectory,
    `deposit-router-pause-${chainId}.json`,
    buildDepositRouterControl(rollout, "pause"),
  );
  const depositRouterBatchPaths = batches.map(({ index, transactionBuilder }) =>
    writeJson(
      outputDirectory,
      `deposit-router-all-token-${chainId}-${index}.json`,
      transactionBuilder,
    ),
  );
  const depositRouterUnpausePath = writeJson(
    outputDirectory,
    `deposit-router-unpause-${chainId}.json`,
    buildDepositRouterControl(rollout, "unpause"),
  );
  const manifestPath = writeJson(
    outputDirectory,
    `external-bridge-rollout-manifest-${chainId}.json`,
    {
      generatedAt: new Date().toISOString(),
      chainId,
      sourceDepositPlan: depositPlanPath,
      sourcePolicy: path.resolve(args.policy),
      ...(args.settings
        ? { sourceSettings: path.resolve(args.settings) }
        : {}),
      summary: rollout.summary,
      inventory: rollout.inventory,
      depositRouterUpdates: rollout.depositRouter.updates,
      outputs: {
        bridgeConfigPath,
        vaultConfigPath,
        verifierPolicyPaths,
        baselinePolicyHash: rollout.baselinePolicyHash,
        depositRouterPausePath,
        depositRouterBatchPaths,
        depositRouterUnpausePath,
      },
    },
  );
  console.log(
    JSON.stringify(
      {
        mode: args.mode === "finalize" ? "finalize" : "rollout",
        chainId,
        ...rollout.summary,
        bridgeConfigPath,
        vaultConfigPath,
        verifierPolicyPaths,
        baselinePolicyHash: rollout.baselinePolicyHash,
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
