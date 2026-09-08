const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const ZERO_ADDRESS = ethers.ZeroAddress;

const keyAddress = (value) => ethers.getAddress(value).toLowerCase();

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

function readManifestOutput(manifestDirectory, file, label) {
  const configuredPath = path.resolve(file);
  const resolvedPath = fs.existsSync(configuredPath)
    ? configuredPath
    : path.join(manifestDirectory, path.basename(file));
  return readJson(resolvedPath, label);
}

function buildExpectedConfiguration(manifest, manifestDirectory) {
  const chainId = Number(manifest.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Manifest chainId must be a positive safe integer");
  }
  const bridgeConfig = readManifestOutput(
    manifestDirectory,
    manifest.outputs?.bridgeConfigPath,
    "ExternalAssetBridge output",
  );
  const vaultConfig = readManifestOutput(
    manifestDirectory,
    manifest.outputs?.vaultConfigPath,
    "ExternalBridgeVault output",
  );
  const bridgeChain = (bridgeConfig.chains || []).find(
    (chain) => Number(chain.externalChainId) === chainId,
  );
  const vaultChain = (vaultConfig.chains || []).find(
    (chain) => Number(chain.chainId) === chainId,
  );
  if (!bridgeChain || !vaultChain) {
    throw new Error(`Generated configuration has no chain ${chainId}`);
  }

  const routes = new Map();
  const tokens = new Map();
  for (const update of manifest.depositRouterUpdates || []) {
    const token = ethers.getAddress(update.token);
    const targetStratoToken = ethers.getAddress(update.targetStratoToken);
    const routeKey = `${keyAddress(token)}:${keyAddress(targetStratoToken)}`;
    const expectedRoute = {
      token,
      targetStratoToken,
      permitted: update.permitted === true,
    };
    const existingRoute = routes.get(routeKey);
    if (
      existingRoute &&
      existingRoute.permitted !== expectedRoute.permitted
    ) {
      throw new Error(`Conflicting DepositRouter policy for ${routeKey}`);
    }
    routes.set(routeKey, expectedRoute);

    const tokenKey = keyAddress(token);
    const minimum = String(update.minDepositAmount);
    const existingToken = tokens.get(tokenKey);
    if (existingToken && existingToken.minimum !== minimum) {
      throw new Error(`Conflicting minimum deposit amounts for ${token}`);
    }
    tokens.set(tokenKey, {
      token,
      minimum,
      permitted: (existingToken?.permitted || false) || expectedRoute.permitted,
    });
  }
  if (!routes.size) throw new Error("Manifest has no DepositRouter updates");

  return {
    chainId,
    deploymentBlock: Number(bridgeChain.lastProcessedBlock),
    depositRouterAddress: ethers.getAddress(vaultChain.depositRouterAddress),
    ownerAddress: ethers.getAddress(vaultChain.safeAddress),
    vaultAddress: ethers.getAddress(vaultChain.vaultAddress),
    routes,
    tokens,
  };
}

async function verifyFromManifest(manifestPath) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifest = readJson(absoluteManifestPath, "rollout manifest");
  const expected = buildExpectedConfiguration(
    manifest,
    path.dirname(absoluteManifestPath),
  );
  const configuredAddress = process.env.DEPOSIT_ROUTER_ADDRESS;
  if (
    ethers.isAddress(configuredAddress) &&
    configuredAddress !== ZERO_ADDRESS &&
    keyAddress(configuredAddress) !==
      keyAddress(expected.depositRouterAddress)
  ) {
    throw new Error(
      "DEPOSIT_ROUTER_ADDRESS does not match the rollout manifest",
    );
  }

  const artifact =
    require("../artifacts/contracts/bridge/DepositRouter.sol/DepositRouter.json");
  const contract = await ethers.getContractAt(
    artifact.abi,
    expected.depositRouterAddress,
  );
  const [network, code, paused, owner, vault, routeEvents] = await Promise.all([
    ethers.provider.getNetwork(),
    ethers.provider.getCode(expected.depositRouterAddress),
    contract.paused(),
    contract.owner(),
    contract.externalBridgeVault(),
    contract.queryFilter(
      contract.filters.RoutePermittedUpdated(),
      expected.deploymentBlock,
      "latest",
    ),
  ]);
  const errors = [];
  if (Number(network.chainId) !== expected.chainId) {
    errors.push(
      `Connected chain ${network.chainId} does not match ${expected.chainId}`,
    );
  }
  if (code === "0x") errors.push("DepositRouter has no deployed bytecode");
  if (!paused) errors.push("DepositRouter is not paused");
  if (keyAddress(owner) !== keyAddress(expected.ownerAddress)) {
    errors.push(`Owner mismatch: expected ${expected.ownerAddress}, got ${owner}`);
  }
  if (keyAddress(vault) !== keyAddress(expected.vaultAddress)) {
    errors.push(`Vault mismatch: expected ${expected.vaultAddress}, got ${vault}`);
  }

  const tokenResults = [];
  for (const expectedToken of expected.tokens.values()) {
    const current = await contract.tokenConfig(expectedToken.token);
    const actual = {
      token: expectedToken.token,
      minimum: String(current.min ?? current[0]),
      permitted: Boolean(current.isPermitted ?? current[1]),
    };
    tokenResults.push(actual);
    if (actual.minimum !== expectedToken.minimum) {
      errors.push(
        `${actual.token} minimum mismatch: expected ${expectedToken.minimum}, got ${actual.minimum}`,
      );
    }
    if (actual.permitted !== expectedToken.permitted) {
      errors.push(
        `${actual.token} permission mismatch: expected ${expectedToken.permitted}, got ${actual.permitted}`,
      );
    }
  }

  const observedRoutes = new Map();
  for (const event of routeEvents) {
    const token = ethers.getAddress(event.args.token);
    const targetStratoToken = ethers.getAddress(event.args.targetStratoToken);
    observedRoutes.set(`${keyAddress(token)}:${keyAddress(targetStratoToken)}`, {
      token,
      targetStratoToken,
    });
  }
  const routeResults = [];
  for (const [routeKey, route] of new Map([
    ...expected.routes,
    ...observedRoutes,
  ])) {
    const actualPermitted = await contract.routePermitted(
      route.token,
      route.targetStratoToken,
    );
    const expectedPermitted = expected.routes.get(routeKey)?.permitted || false;
    routeResults.push({
      token: route.token,
      targetStratoToken: route.targetStratoToken,
      expectedPermitted,
      actualPermitted,
    });
    if (actualPermitted !== expectedPermitted) {
      errors.push(
        `${routeKey} permission mismatch: expected ${expectedPermitted}, got ${actualPermitted}`,
      );
    }
  }

  const report = {
    manifest: absoluteManifestPath,
    chainId: expected.chainId,
    deploymentBlock: expected.deploymentBlock,
    depositRouterAddress: expected.depositRouterAddress,
    paused,
    owner,
    vault,
    tokens: tokenResults,
    routes: routeResults,
    status: errors.length ? "FAILED" : "PASSED",
    errors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) {
    throw new Error(
      `DepositRouter verification failed with ${errors.length} error(s)`,
    );
  }
  return report;
}

async function scanConfiguredTokens() {
  const contractAddress = process.env.DEPOSIT_ROUTER_ADDRESS;
  if (!contractAddress) {
    throw new Error("DEPOSIT_ROUTER_ADDRESS is required");
  }
  const artifact =
    require("../artifacts/contracts/bridge/DepositRouter.sol/DepositRouter.json");
  const contract = await ethers.getContractAt(artifact.abi, contractAddress);
  const events = await contract.queryFilter(
    contract.filters.TokenConfigUpdated(),
    0,
    "latest",
  );
  const configuredTokens = new Set(
    events.map((event) => ethers.getAddress(event.args.token)),
  );
  const output = [];
  for (const token of configuredTokens) {
    const current = await contract.tokenConfig(token);
    output.push({
      token,
      minimum: String(current.min ?? current[0]),
      isPermitted: Boolean(current.isPermitted ?? current[1]),
    });
  }
  console.log(JSON.stringify({ contractAddress, tokens: output }, null, 2));
  return output;
}

async function main() {
  if (process.env.ROLLOUT_MANIFEST) {
    await verifyFromManifest(process.env.ROLLOUT_MANIFEST);
    return;
  }
  await scanConfiguredTokens();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`scanTokenConfig failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildExpectedConfiguration,
  verifyFromManifest,
};
