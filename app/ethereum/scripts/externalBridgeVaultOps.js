const fs = require("fs");
const path = require("path");
require("dotenv").config();
require("dotenv").config({
  path: path.resolve(__dirname, "../../services/bridge/.env"),
});

const { ethers } = require("ethers");
const {
  getRpcUrl,
  loadDepositRouterArtifact,
  proposeBatch,
  writeOutput,
  buildTransactionBuilderBatch,
  writeTransactionBuilderOutput,
} = require("./lib/depositRouterSafeOps");
const {
  ZERO_ADDRESS,
  normalizeConfig,
  buildOperations,
  validateServiceSigners,
} = require("./lib/externalBridgeVaultPlan");

const VAULT_ARTIFACT = path.resolve(
  __dirname,
  "../artifacts/contracts/bridge/ExternalBridgeVault.sol/ExternalBridgeVault.json",
);
const ERC20_ABI = [
  "function transfer(address recipient,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

function parseArgs(argv) {
  const args = { apply: false, step: "all" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") {
      args.apply = true;
      continue;
    }
    if (!["--config", "--chains", "--step"].includes(value)) {
      throw new Error(`Unsupported option ${value}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${value}`);
    }
    args[value.slice(2)] = next;
    index += 1;
  }
  if (!args.config) throw new Error("--config is required");
  if (!["all", "configure", "router", "liquidity", "verify"].includes(args.step)) {
    throw new Error("--step must be all|configure|router|liquidity|verify");
  }
  return args;
}

function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Configuration file not found: ${absolutePath}`);
  }
  return normalizeConfig(JSON.parse(fs.readFileSync(absolutePath, "utf8")));
}

function loadVaultArtifact() {
  if (!fs.existsSync(VAULT_ARTIFACT)) {
    throw new Error(`ExternalBridgeVault artifact missing: ${VAULT_ARTIFACT}`);
  }
  return JSON.parse(fs.readFileSync(VAULT_ARTIFACT, "utf8"));
}

function selectChains(config, chainsCsv) {
  if (!chainsCsv) return config.chains;
  const requested = new Set(
    String(chainsCsv)
      .split(",")
      .map((value) => Number(value.trim())),
  );
  const selected = config.chains.filter((chain) => requested.has(chain.chainId));
  if (selected.length !== requested.size) {
    throw new Error("--chains includes a chain absent from the configuration");
  }
  return selected;
}

function encodeOperations(operations, vaultInterface, routerInterface) {
  const erc20Interface = new ethers.Interface(ERC20_ABI);
  return operations.map((operation) => {
    let data = "0x";
    if (operation.method !== "transferNative") {
      const iface =
        operation.method === "setExternalBridgeVault"
          ? routerInterface
          : operation.method === "transfer"
            ? erc20Interface
            : vaultInterface;
      data = iface.encodeFunctionData(operation.method, operation.args);
    }
    return {
      to: operation.target,
      value: operation.value.toString(),
      data,
      operation: 0,
    };
  });
}

async function readState(config, chain, vaultArtifact, routerArtifact) {
  const provider = new ethers.JsonRpcProvider(getRpcUrl(chain.chainId));
  const [vaultCode, routerCode] = await Promise.all([
    provider.getCode(chain.vaultAddress),
    provider.getCode(chain.depositRouterAddress),
  ]);
  if (vaultCode === "0x") {
    throw new Error(`Chain ${chain.chainId}: vault has no bytecode`);
  }
  if (routerCode === "0x") {
    throw new Error(`Chain ${chain.chainId}: DepositRouter has no bytecode`);
  }

  const vault = new ethers.Contract(
    chain.vaultAddress,
    vaultArtifact.abi,
    provider,
  );
  const router = new ethers.Contract(
    chain.depositRouterAddress,
    routerArtifact.abi,
    provider,
  );
  const governanceRoleNames = [
    "DEFAULT_ADMIN_ROLE",
    "UPGRADER_ROLE",
    "POLICY_ADMIN_ROLE",
    "PAUSER_ROLE",
    "UNPAUSER_ROLE",
    "ATTESTATION_ADMIN_ROLE",
    "LARGE_WITHDRAWAL_APPROVER_ROLE",
  ];
  const governanceRoles = await Promise.all(
    governanceRoleNames.map(async (name) => ({
      name,
      role: await vault[name](),
    })),
  );
  const [safeRoleStates, pauserRole] = await Promise.all([
    Promise.all(
      governanceRoles.map(async ({ name, role }) => ({
        role: name,
        granted: await vault.hasRole(role, chain.safeAddress),
      })),
    ),
    vault.PAUSER_ROLE(),
  ]);
  const [
    guardianCanPause,
    sourceBridgeEnabled,
    threshold,
    signerCount,
    maxValidity,
    routerOwner,
    currentVault,
  ] = await Promise.all([
    vault.hasRole(pauserRole, chain.guardianAddress),
    vault.sourceBridges(config.sourceChainId, config.sourceBridge),
    vault.attestationThreshold(),
    vault.attestationSignerCount(),
    vault.maxAuthorizationValiditySeconds(),
    router.owner(),
    router.externalBridgeVault(),
  ]);
  const signerStates = await Promise.all(
    [
      ...chain.attestationSigners.map((address) => ({
        address,
        expectedEnabled: true,
      })),
      ...chain.disabledAttestationSigners.map((address) => ({
        address,
        expectedEnabled: false,
      })),
    ].map(async ({ address, expectedEnabled }) => ({
      address,
      expectedEnabled,
      enabled: await vault.attestationSigners(address),
    })),
  );
  const tokenStates = await Promise.all(
    chain.tokens.map(async (token) => {
      const [policy, vaultBalance, safeBalance] = await Promise.all([
        vault.tokenPolicies(token.token),
        token.token === ZERO_ADDRESS
          ? provider.getBalance(chain.vaultAddress)
          : new ethers.Contract(token.token, ERC20_ABI, provider).balanceOf(
              chain.vaultAddress,
            ),
        token.token === ZERO_ADDRESS
          ? provider.getBalance(chain.safeAddress)
          : new ethers.Contract(token.token, ERC20_ABI, provider).balanceOf(
              chain.safeAddress,
            ),
      ]);
      return {
        token: token.token,
        policy: {
          enabled: policy.enabled,
          maxPerWithdrawal: policy.maxPerWithdrawal.toString(),
          windowLimit: policy.windowLimit.toString(),
          windowSeconds: policy.windowSeconds.toString(),
          manualReviewThreshold: policy.manualReviewThreshold.toString(),
        },
        policyMatches:
          policy.enabled === token.enabled &&
          policy.maxPerWithdrawal === token.maxPerWithdrawal &&
          policy.windowLimit === token.windowLimit &&
          policy.windowSeconds === token.windowSeconds &&
          policy.manualReviewThreshold === token.manualReviewThreshold,
        vaultBalance: vaultBalance.toString(),
        safeBalance: safeBalance.toString(),
        migrationFunded: safeBalance >= token.migrateAmount,
      };
    }),
  );

  return {
    safeRoleStates,
    safeHasGovernanceRoles: safeRoleStates.every(({ granted }) => granted),
    guardianCanPause,
    sourceBridgeEnabled,
    attestationThreshold: threshold.toString(),
    attestationSignerCount: signerCount.toString(),
    maxAuthorizationValiditySeconds: maxValidity.toString(),
    signerStates,
    routerOwner,
    routerOwnerIsSafe:
      routerOwner.toLowerCase() === chain.safeAddress.toLowerCase(),
    currentVault,
    routerTargetsVault:
      currentVault.toLowerCase() === chain.vaultAddress.toLowerCase(),
    tokenStates,
    configurationMatches:
      sourceBridgeEnabled &&
      threshold === BigInt(chain.attestationThreshold) &&
      signerCount === BigInt(chain.attestationSigners.length) &&
      maxValidity === chain.maxAuthorizationValiditySeconds &&
      signerStates.every(
        ({ enabled, expectedEnabled }) => enabled === expectedEnabled,
      ) &&
      tokenStates.every(({ policyMatches }) => policyMatches),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  const chains = selectChains(config, args.chains);
  const vaultArtifact = loadVaultArtifact();
  const routerArtifact = loadDepositRouterArtifact();
  const vaultInterface = new ethers.Interface(vaultArtifact.abi);
  const routerInterface = new ethers.Interface(routerArtifact.abi);
  const summary = {
    apply: args.apply,
    step: args.step,
    sourceChainId: config.sourceChainId.toString(),
    sourceBridge: config.sourceBridge,
    chains: [],
  };

  for (const chain of chains) {
    const operations = buildOperations(config, chain);
    const state = await readState(config, chain, vaultArtifact, routerArtifact);
    if (state.routerTargetsVault) {
      operations.router = [];
    }
    const serviceSigners = validateServiceSigners(chain);
    if (!state.safeHasGovernanceRoles) {
      throw new Error(`Chain ${chain.chainId}: Safe is missing a vault role`);
    }
    if (!state.guardianCanPause) {
      throw new Error(`Chain ${chain.chainId}: guardian cannot pause the vault`);
    }
    if (!state.routerOwnerIsSafe) {
      throw new Error(`Chain ${chain.chainId}: Safe is not DepositRouter owner`);
    }
    if (
      args.step === "verify" &&
      (!state.configurationMatches ||
        !state.routerTargetsVault ||
        !serviceSigners.valid)
    ) {
      throw new Error(
        `Chain ${chain.chainId}: deployed configuration does not match the rollout plan`,
      );
    }
    if (
      args.apply &&
      ["all", "configure", "liquidity"].includes(args.step) &&
      !serviceSigners.valid
    ) {
      throw new Error(
        `Chain ${chain.chainId}: service validator keys do not satisfy the configured signer threshold`,
      );
    }
    if (
      args.apply &&
      ["all", "liquidity"].includes(args.step) &&
      state.tokenStates.some((token) => !token.migrationFunded)
    ) {
      throw new Error(`Chain ${chain.chainId}: Safe migration balance is insufficient`);
    }

    const chainSummary = {
      chainId: chain.chainId,
      safeAddress: chain.safeAddress,
      vaultAddress: chain.vaultAddress,
      depositRouterAddress: chain.depositRouterAddress,
      currentState: state,
      serviceSignerValidation: serviceSigners,
      expectedServiceEnvironment: [
        `CHAIN_${chain.chainId}_RPC_URL`,
        `CHAIN_${chain.chainId}_EXTERNAL_BRIDGE_SIGNER_ADDRESSES`,
        `CHAIN_${chain.chainId}_EXTERNAL_BRIDGE_SIGNER_URLS`,
        `CHAIN_${chain.chainId}_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS`,
        `CHAIN_${chain.chainId}_EXTERNAL_BRIDGE_EXECUTOR_KMS_URL`,
        `CHAIN_${chain.chainId}_EXTERNAL_BRIDGE_EXECUTOR_KMS_API_TOKEN`,
        `CHAIN_${chain.chainId}_EXTERNAL_BRIDGE_EXECUTOR_PRIVATE_KEY`,
      ],
      proposals: [],
      transactionBuilderFiles: [],
    };

    for (const step of ["configure", "router", "liquidity"]) {
      if (
        (args.step !== "all" && args.step !== step) ||
        operations[step].length === 0
      ) {
        continue;
      }
      const transactions = encodeOperations(
        operations[step],
        vaultInterface,
        routerInterface,
      );
      const transactionBuilder = buildTransactionBuilderBatch(
        chain.chainId,
        chain.safeAddress,
        transactions,
        {
          name: `External bridge ${step} (${chain.chainId})`,
          description: `ExternalAssetBridge rollout ${step} operations`,
        },
      );
      chainSummary.transactionBuilderFiles.push(
        writeTransactionBuilderOutput(
          `external-bridge-vault-${chain.chainId}-${step}`,
          transactionBuilder,
        ),
      );
      if (args.apply) {
        const proposal = await proposeBatch(chain.chainId, transactions, {
          safeAddress: chain.safeAddress,
        });
        chainSummary.proposals.push({ step, transactions, ...proposal });
      } else {
        chainSummary.proposals.push({ step, transactions });
      }
    }
    summary.chains.push(chainSummary);
  }

  const outputPath = writeOutput("external-bridge-vault-ops", summary);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Output: ${outputPath}`);
  if (!args.apply) {
    console.log("Dry run only. Re-run with --apply after reviewing the output.");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("externalBridgeVaultOps failed:", error.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadConfig, selectChains, encodeOperations };
