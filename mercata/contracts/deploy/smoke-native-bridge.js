/**
 * Read-only smoke check for the native STRATO bridge deployment.
 *
 * Checks:
 * - STRATO bridge proxy state
 * - STRATO custody vault state
 * - STRATO native route wiring for one external chain
 * - Sepolia representation bridge mapping + roles
 * - Bridge-service env alignment for native addresses
 *
 * Usage:
 *   npm run smoke:native-bridge -- --external-chain-id 11155111
 */
const path = require("path");
require("dotenv").config({
  path: process.env.SMOKE_NATIVE_BRIDGE_ENV_FILE || path.resolve(__dirname, "../.env.smoke-native-bridge"),
});

const axios = require("axios");
const { ethers } = require("ethers");

const DEFAULT_EXTERNAL_CHAIN_ID = "11155111";
const BRIDGE_ROLE = ethers.id("BRIDGE_ROLE");

const REPRESENTATION_BRIDGE_ABI = [
  "function stratoToRepresentation(address) view returns (address)",
  "function representationToStrato(address) view returns (address)",
  "function routeActive(address) view returns (bool)",
  "function routeFrozen(address) view returns (bool)",
  "function attestationSigners(address) view returns (bool)",
  "function attestationThreshold() view returns (uint8)",
  "function attestationSignerCount() view returns (uint8)",
  "function hasRole(bytes32,address) view returns (bool)",
];

const REPRESENTATION_TOKEN_ABI = [
  "function hasRole(bytes32,address) view returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for argument: ${arg}`);
    }

    parsed[key] = value;
    i += 1;
  }

  return parsed;
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function getOptionalEnv(name) {
  const value = process.env[name];
  return value == null ? undefined : value.trim();
}

function normalizeAddress(value, label) {
  try {
    const withPrefix = value.startsWith("0x") ? value : `0x${value}`;
    return ethers.getAddress(withPrefix);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function parseAddressList(value, label) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeAddress(item, label));
}

function normalizeStratoKeyCandidates(address) {
  const canonical = normalizeAddress(address, "STRATO address");
  const lower = canonical.toLowerCase();
  return Array.from(new Set([lower, lower.slice(2)]));
}

function toCirrusAddress(address, label) {
  return normalizeAddress(address, label).toLowerCase().replace(/^0x/, "");
}

function pushCheck(checks, ok, label, details) {
  checks.push({ ok, label, details });
}

function logSection(title) {
  console.log(`\n== ${title} ==`);
}

function logChecks(checks) {
  checks.forEach(({ ok, label, details }) => {
    const prefix = ok ? "[PASS]" : "[FAIL]";
    console.log(`${prefix} ${label}`);
    if (details) {
      console.log(`       ${details}`);
    }
  });
}

async function fetchSingleRow(tableName, params, label) {
  const rows = await cirrusSearch(tableName, params);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No Cirrus rows found for ${label}`);
  }
  return rows[0];
}

let cachedStratoToken;

async function getStratoAccessToken() {
  if (cachedStratoToken) {
    return cachedStratoToken;
  }

  const username = getRequiredEnv("GLOBAL_ADMIN_NAME");
  const password = getRequiredEnv("GLOBAL_ADMIN_PASSWORD");
  const discoveryUrl = getRequiredEnv("OAUTH_URL");
  const clientId = getRequiredEnv("OAUTH_CLIENT_ID");
  const clientSecret = getRequiredEnv("OAUTH_CLIENT_SECRET");

  const discovery = await axios.get(discoveryUrl, {
    headers: { "Content-Type": "application/json" },
  });

  const tokenEndpoint = discovery.data && discovery.data.token_endpoint;
  if (!tokenEndpoint) {
    throw new Error(`OAuth discovery document did not include token_endpoint: ${discoveryUrl}`);
  }

  const tokenResponse = await axios.post(
    tokenEndpoint,
    new URLSearchParams({
      grant_type: "password",
      client_id: clientId,
      client_secret: clientSecret,
      username,
      password,
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  cachedStratoToken = tokenResponse.data && tokenResponse.data.access_token;
  if (!cachedStratoToken) {
    throw new Error("OAuth token response did not include access_token");
  }
  return cachedStratoToken;
}

async function cirrusSearch(tableName, params = {}) {
  const token = await getStratoAccessToken();
  const nodeUrl = getRequiredEnv("NODE_URL").replace(/\/$/, "");
  const cirrusUrl = `${nodeUrl}/cirrus/search/${tableName}`;

  const { data } = await axios.get(cirrusUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    params,
  });

  return data;
}

async function fetchStratoBridgeState(bridgeAddress) {
  return fetchSingleRow(
    "BlockApps-StratoNativeBridge",
    {
      address: `eq.${toCirrusAddress(bridgeAddress, "STRATO native bridge address")}`,
      select:
        "_owner,tokenFactory,custodyVault,bridgeOperator,guardian,depositsPaused,withdrawalsPaused",
    },
    `native bridge ${bridgeAddress}`
  );
}

async function fetchStratoVaultState(vaultAddress) {
  return fetchSingleRow(
    "BlockApps-StratoNativeCustodyVault",
    {
      address: `eq.${toCirrusAddress(vaultAddress, "STRATO native custody vault address")}`,
      select: "_owner,bridge,guardian,paused",
    },
    `native custody vault ${vaultAddress}`
  );
}

async function fetchStratoAssetState(bridgeAddress, stratoToken, externalChainId) {
  const candidates = normalizeStratoKeyCandidates(stratoToken);
  const rows = await cirrusSearch("BlockApps-StratoNativeBridge-assets", {
    address: `eq.${toCirrusAddress(bridgeAddress, "STRATO native bridge address")}`,
    key: `in.(${candidates.join(",")})`,
    key2: `eq.${externalChainId}`,
    select: "key,key2,value",
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      `No STRATO native asset route found for token ${stratoToken} on chain ${externalChainId}`
    );
  }

  return rows[0];
}

async function runStratoChecks({
  bridgeAddress,
  vaultAddress,
  stratoTokenAddress,
  externalChainId,
  expectedExternalBridge,
  expectedRepresentationToken,
  expectedBridgeOperator,
  expectedGuardian,
}) {
  const checks = [];

  const [bridgeState, vaultState, assetRow] = await Promise.all([
    fetchStratoBridgeState(bridgeAddress),
    fetchStratoVaultState(vaultAddress),
    fetchStratoAssetState(bridgeAddress, stratoTokenAddress, externalChainId),
  ]);

  const asset = assetRow.value || {};
  const actualVault = normalizeAddress(bridgeState.custodyVault, "STRATO custody vault");
  const actualVaultBridge = normalizeAddress(vaultState.bridge, "vault bridge");
  const actualExternalBridge = normalizeAddress(
    asset.externalBridge,
    "STRATO route externalBridge"
  );
  const actualRepresentationToken = normalizeAddress(
    asset.representationToken,
    "STRATO route representationToken"
  );

  pushCheck(
    checks,
    actualVault === vaultAddress,
    "STRATO bridge points at expected custody vault",
    `bridge.custodyVault=${actualVault}`
  );
  pushCheck(
    checks,
    actualVaultBridge === bridgeAddress,
    "STRATO vault points back at expected bridge",
    `vault.bridge=${actualVaultBridge}`
  );
  pushCheck(
    checks,
    actualExternalBridge === expectedExternalBridge,
    "STRATO route external bridge matches Sepolia representation bridge",
    `route.externalBridge=${actualExternalBridge}`
  );
  pushCheck(
    checks,
    actualRepresentationToken === expectedRepresentationToken,
    "STRATO route representation token matches Sepolia representation token",
    `route.representationToken=${actualRepresentationToken}`
  );
  pushCheck(
    checks,
    asset.enabled === true,
    "STRATO native route is enabled",
    `route.enabled=${String(asset.enabled)}`
  );
  pushCheck(
    checks,
    bridgeState.depositsPaused === false,
    "STRATO native bridge deposits are not paused",
    `depositsPaused=${String(bridgeState.depositsPaused)}`
  );
  pushCheck(
    checks,
    bridgeState.withdrawalsPaused === false,
    "STRATO native bridge withdrawals are not paused",
    `withdrawalsPaused=${String(bridgeState.withdrawalsPaused)}`
  );
  pushCheck(
    checks,
    vaultState.paused === false,
    "STRATO native custody vault is not paused",
    `vault.paused=${String(vaultState.paused)}`
  );

  if (expectedBridgeOperator) {
    const actualBridgeOperator = normalizeAddress(
      bridgeState.bridgeOperator,
      "STRATO bridge operator"
    );
    pushCheck(
      checks,
      actualBridgeOperator === expectedBridgeOperator,
      "STRATO bridge operator matches expected relayer/operator",
      `bridge.bridgeOperator=${actualBridgeOperator}`
    );
  }

  if (expectedGuardian) {
    const actualBridgeGuardian = normalizeAddress(
      bridgeState.guardian,
      "STRATO bridge guardian"
    );
    const actualVaultGuardian = normalizeAddress(vaultState.guardian, "STRATO vault guardian");
    pushCheck(
      checks,
      actualBridgeGuardian === expectedGuardian,
      "STRATO bridge guardian matches expected guardian",
      `bridge.guardian=${actualBridgeGuardian}`
    );
    pushCheck(
      checks,
      actualVaultGuardian === expectedGuardian,
      "STRATO vault guardian matches expected guardian",
      `vault.guardian=${actualVaultGuardian}`
    );
  }

  return {
    checks,
    summary: {
      owner: bridgeState._owner,
      tokenFactory: bridgeState.tokenFactory,
      maxPerWithdrawal: asset.maxPerWithdrawal,
      externalName: asset.externalName,
      externalSymbol: asset.externalSymbol,
    },
  };
}

async function runSepoliaChecks({
  externalChainId,
  rpcUrl,
  stratoTokenAddress,
  representationBridgeAddress,
  representationTokenAddress,
  expectedAttestationSigners,
}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const checks = [];

  pushCheck(
    checks,
    network.chainId === BigInt(externalChainId),
    "RPC points at the expected external chain",
    `rpc chainId=${network.chainId.toString()}`
  );

  const [bridgeCode, tokenCode] = await Promise.all([
    provider.getCode(representationBridgeAddress),
    provider.getCode(representationTokenAddress),
  ]);

  pushCheck(
    checks,
    bridgeCode !== "0x",
    "Sepolia representation bridge code exists",
    `codeLength=${bridgeCode.length}`
  );
  pushCheck(
    checks,
    tokenCode !== "0x",
    "Sepolia representation token code exists",
    `codeLength=${tokenCode.length}`
  );

  const bridge = new ethers.Contract(
    representationBridgeAddress,
    REPRESENTATION_BRIDGE_ABI,
    provider
  );
  const token = new ethers.Contract(
    representationTokenAddress,
    REPRESENTATION_TOKEN_ABI,
    provider
  );

  const [
    mappedRepresentation,
    reverseMappedStrato,
    routeActive,
    routeFrozen,
    bridgeHasMintRole,
    attestationThreshold,
    attestationSignerCount,
    tokenName,
    tokenSymbol,
  ] = await Promise.all([
    bridge.stratoToRepresentation(stratoTokenAddress),
    bridge.representationToStrato(representationTokenAddress),
    bridge.routeActive(stratoTokenAddress),
    bridge.routeFrozen(stratoTokenAddress),
    token.hasRole(BRIDGE_ROLE, representationBridgeAddress),
    bridge.attestationThreshold(),
    bridge.attestationSignerCount(),
    token.name(),
    token.symbol(),
  ]);

  pushCheck(
    checks,
    normalizeAddress(mappedRepresentation, "Sepolia mapping token") === representationTokenAddress,
    "Sepolia bridge maps STRATO token to expected representation token",
    `stratoToRepresentation=${mappedRepresentation}`
  );
  pushCheck(
    checks,
    normalizeAddress(reverseMappedStrato, "Sepolia reverse mapping") === stratoTokenAddress,
    "Sepolia bridge reverse mapping points back to STRATO token",
    `representationToStrato=${reverseMappedStrato}`
  );
  pushCheck(
    checks,
    routeActive === true,
    "Sepolia route is active",
    `routeActive=${String(routeActive)}`
  );
  pushCheck(
    checks,
    routeFrozen === false,
    "Sepolia route is not frozen",
    `routeFrozen=${String(routeFrozen)}`
  );
  pushCheck(
    checks,
    bridgeHasMintRole === true,
    "Sepolia representation token grants BRIDGE_ROLE to representation bridge",
    `hasRole(BRIDGE_ROLE, bridge)=${String(bridgeHasMintRole)}`
  );

  if (expectedAttestationSigners.length > 0) {
    const signerChecks = await Promise.all(
      expectedAttestationSigners.map((signer) => bridge.attestationSigners(signer))
    );
    signerChecks.forEach((enabled, index) => {
      pushCheck(
        checks,
        enabled === true,
        "Sepolia bridge enables expected native mint attestation signer",
        `signer=${expectedAttestationSigners[index]}, enabled=${String(enabled)}`
      );
    });
  }

  pushCheck(
    checks,
    BigInt(attestationThreshold) > 0n &&
      BigInt(attestationThreshold) <= BigInt(attestationSignerCount),
    "Sepolia bridge has a satisfiable native mint attestation threshold",
    `attestationThreshold=${String(attestationThreshold)}, attestationSignerCount=${String(attestationSignerCount)}`
  );

  return {
    checks,
    summary: {
      rpcChainId: network.chainId.toString(),
      tokenName,
      tokenSymbol,
    },
  };
}

async function main() {
  const args = parseArgs();
  const externalChainId = String(
    args["external-chain-id"] || process.env.EXTERNAL_CHAIN_ID || DEFAULT_EXTERNAL_CHAIN_ID
  );

  if (!/^[0-9]+$/.test(externalChainId) || externalChainId === "0") {
    throw new Error(`Invalid external chain id: ${externalChainId}`);
  }

  const bridgeAddress = normalizeAddress(
    getRequiredEnv("STRATO_NATIVE_BRIDGE_ADDRESS"),
    "STRATO_NATIVE_BRIDGE_ADDRESS"
  );
  const vaultAddress = normalizeAddress(
    getRequiredEnv("STRATO_NATIVE_CUSTODY_VAULT_ADDRESS"),
    "STRATO_NATIVE_CUSTODY_VAULT_ADDRESS"
  );
  const stratoTokenAddress = normalizeAddress(
    getRequiredEnv("STRATO_TOKEN_ADDRESS"),
    "STRATO_TOKEN_ADDRESS"
  );
  const rpcEnvName = `CHAIN_${externalChainId}_RPC_URL`;
  const representationBridgeEnvName = `CHAIN_${externalChainId}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`;
  const representationTokenEnvName = `CHAIN_${externalChainId}_REPRESENTATION_TOKEN_ADDRESS`;
  const expectedBridgeOperatorRaw = getOptionalEnv("BRIDGE_OPERATOR");
  const expectedGuardianRaw = getOptionalEnv("GUARDIAN");
  const expectedAttestationSigners = parseAddressList(
    getOptionalEnv("NATIVE_MINT_ATTESTATION_SIGNERS"),
    "NATIVE_MINT_ATTESTATION_SIGNERS"
  );
  const rpcUrl = getRequiredEnv(rpcEnvName);
  const representationBridgeAddress = normalizeAddress(
    getRequiredEnv(representationBridgeEnvName),
    representationBridgeEnvName
  );
  const representationTokenAddress = normalizeAddress(
    getRequiredEnv(representationTokenEnvName),
    representationTokenEnvName
  );
  const expectedBridgeOperator = expectedBridgeOperatorRaw
    ? normalizeAddress(expectedBridgeOperatorRaw, "BRIDGE_OPERATOR")
    : undefined;
  const expectedGuardian = expectedGuardianRaw
    ? normalizeAddress(expectedGuardianRaw, "GUARDIAN")
    : undefined;

  console.log("Native bridge smoke check plan:");
  console.log(
    JSON.stringify(
      {
        externalChainId,
        stratoBridge: bridgeAddress,
        stratoVault: vaultAddress,
        stratoToken: stratoTokenAddress,
        serviceEnvBridge: bridgeAddress,
        serviceEnvRepresentationBridge: representationBridgeAddress,
        representationToken: representationTokenAddress,
        rpcEnvName,
        representationBridgeEnvName,
        representationTokenEnvName,
        bridgeOperator: expectedBridgeOperator || "(not provided)",
        nativeMintAttestationSigners: expectedAttestationSigners,
        guardian: expectedGuardian || "(not provided)",
      },
      null,
      2
    )
  );

  const [stratoResult, sepoliaResult] = await Promise.all([
    runStratoChecks({
      bridgeAddress,
      vaultAddress,
      stratoTokenAddress,
      externalChainId,
      expectedExternalBridge: representationBridgeAddress,
      expectedRepresentationToken: representationTokenAddress,
      expectedBridgeOperator,
      expectedGuardian,
    }),
    runSepoliaChecks({
      externalChainId,
      rpcUrl,
      stratoTokenAddress,
      representationBridgeAddress,
      representationTokenAddress,
      expectedAttestationSigners,
    }),
  ]);

  logSection("STRATO Checks");
  logChecks(stratoResult.checks);
  console.log(
    `       owner=${stratoResult.summary.owner}, tokenFactory=${stratoResult.summary.tokenFactory}, maxPerWithdrawal=${stratoResult.summary.maxPerWithdrawal}, externalName=${stratoResult.summary.externalName}, externalSymbol=${stratoResult.summary.externalSymbol}`
  );

  logSection("Sepolia Checks");
  logChecks(sepoliaResult.checks);
  console.log(
    `       rpcChainId=${sepoliaResult.summary.rpcChainId}, tokenName=${sepoliaResult.summary.tokenName}, tokenSymbol=${sepoliaResult.summary.tokenSymbol}`
  );

  const allChecks = [...stratoResult.checks, ...sepoliaResult.checks];
  const failed = allChecks.filter((check) => !check.ok);

  logSection("Result");
  if (failed.length > 0) {
    console.error(`Smoke check failed: ${failed.length} check(s) did not pass.`);
    process.exit(1);
  }

  console.log(`Smoke check passed: ${allChecks.length} check(s) passed.`);
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
