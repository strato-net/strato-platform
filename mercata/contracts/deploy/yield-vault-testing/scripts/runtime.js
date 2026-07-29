"use strict";

const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");

const localEnvFile = path.join(__dirname, "..", ".env");
const envFile = process.env.DEPLOY_ENV_FILE
  ? path.resolve(process.cwd(), process.env.DEPLOY_ENV_FILE)
  : localEnvFile;
const envResult = dotenv.config({ path: envFile });
if (process.env.DEPLOY_ENV_FILE && envResult.error) {
  throw new Error(`Cannot load DEPLOY_ENV_FILE ${envFile}: ${envResult.error.message}`);
}

// The shared deploy configuration is intentionally imported only after the
// YieldVault environment has been loaded.
const config = require("../../config");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === "" || value === "REPLACE_ME") {
    throw new Error(`Environment variable ${name} must be populated`);
  }
  return value.trim();
}

function optionalEnv(name, fallback = null) {
  const value = process.env[name];
  return value && value.trim() !== "" && value !== "REPLACE_ME" ? value.trim() : fallback;
}

function rootNodeUrl() {
  const value = config.nodes && config.nodes[0] && config.nodes[0].url;
  if (!value) throw new Error("NODE_URL must be populated");
  return String(value).replace(/\/+$/, "");
}

function validateNetworkMetadata(metadata, expected = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("STRATO metadata response must be an object");
  }
  const expectedNetworkID = String(
    expected.networkID == null ? requiredEnv("EXPECTED_NETWORK_ID") : expected.networkID
  );
  const expectedNetworkName =
    expected.networkName === undefined
      ? optionalEnv("EXPECTED_NETWORK_NAME")
      : expected.networkName;
  const requireTestnet =
    expected.requireTestnet === undefined
      ? requiredEnv("REQUIRE_TESTNET").toLowerCase() === "true"
      : expected.requireTestnet;
  const networkID = String(metadata.networkID == null ? "" : metadata.networkID);
  const networkName = String(metadata.networkName == null ? "" : metadata.networkName);

  if (!metadata.isSynced) throw new Error("STRATO node is not synced");
  if (!expectedNetworkID || networkID !== expectedNetworkID) {
    throw new Error(`Network ID mismatch: live=${networkID || "missing"} expected=${expectedNetworkID}`);
  }
  if (expectedNetworkName && networkName !== expectedNetworkName) {
    throw new Error(
      `Network name mismatch: live=${networkName || "missing"} expected=${expectedNetworkName}`
    );
  }
  if (!requireTestnet) {
    throw new Error("REQUIRE_TESTNET must be true for YieldVault testnet tooling");
  }
  if (!networkName || /(mainnet|production|prod|upquark)/i.test(networkName)) {
    throw new Error(`Refusing testnet workflow on network name: ${networkName || "missing"}`);
  }

  return {
    networkID,
    networkName,
    chainId: String(metadata.chainId == null ? "" : metadata.chainId),
    isSynced: true,
    nodeUrl: rootNodeUrl(),
  };
}

async function fetchExpectedTestnetNetwork(tokenObj, getMetadata) {
  const readMetadata =
    getMetadata ||
    (async () => {
      const axios = require("axios");
      const response = await axios.get(`${rootNodeUrl()}/strato-api/eth/v1.2/metadata`, {
        headers: tokenObj && tokenObj.token
          ? { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" }
          : { Accept: "application/json" },
      });
      return response.data;
    });
  return validateNetworkMetadata(await readMetadata());
}

function jsonValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(jsonValue(value), null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
  fsyncDirectory(directory);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(read, done, options = {}) {
  const intervalMs = options.intervalMs == null ? 2000 : options.intervalMs;
  const timeoutMs = options.timeoutMs == null ? 60000 : options.timeoutMs;
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await read();
    if (done(latest)) return latest;
    await sleep(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(options.timeoutMessage || `Polling timed out after ${timeoutMs}ms`);
}

module.exports = {
  atomicWriteJson,
  config,
  envFile,
  fetchExpectedTestnetNetwork,
  optionalEnv,
  pollUntil,
  requiredEnv,
  rootNodeUrl,
  validateNetworkMetadata,
};
