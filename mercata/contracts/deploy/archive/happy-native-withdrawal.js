/**
 * State-changing happy-path runner for native bridge-out:
 * STRATO native token -> bridge service -> Sepolia representation token.
 *
 * This script:
 * 1. Checks STRATO withdrawer and Sepolia recipient balances
 * 2. Approves the STRATO native custody vault
 * 3. Calls requestWithdrawal() on STRATO
 * 4. Waits for the bridge service to mint on Sepolia and finalize on STRATO
 * 5. Verifies the Sepolia recipient representation balance increases
 */
const path = require("path");
require("dotenv").config({
  path:
    process.env.HAPPY_NATIVE_WITHDRAWAL_ENV_FILE ||
    path.resolve(__dirname, "../.env.happy-native-withdrawal"),
});

const axios = require("axios");
const { ethers } = require("ethers");
const config = require("../config");
const auth = require("../auth");
const { rest, util } = require("blockapps-rest");

const DEFAULT_EXTERNAL_CHAIN_ID = "11155111";
const COMPLETED_STATUS = "3";
const ABORTED_STATUS = "4";

const REPRESENTATION_TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
];

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeAddress(value, label) {
  try {
    const withPrefix = value.startsWith("0x") ? value : `0x${value}`;
    return ethers.getAddress(withPrefix);
  } catch (_error) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function toCirrusAddress(address, label) {
  return normalizeAddress(address, label).toLowerCase().replace(/^0x/, "");
}

function stripHexPrefixLower(value) {
  return String(value || "").toLowerCase().replace(/^0x/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logSection(title) {
  console.log(`\n== ${title} ==`);
}

function buildConfig() {
  const externalChainId = String(
    process.env.EXTERNAL_CHAIN_ID || DEFAULT_EXTERNAL_CHAIN_ID
  );
  if (!/^[0-9]+$/.test(externalChainId) || externalChainId === "0") {
    throw new Error(`Invalid EXTERNAL_CHAIN_ID: ${externalChainId}`);
  }

  return {
    externalChainId,
    rpcUrl: getRequiredEnv(`CHAIN_${externalChainId}_RPC_URL`),
    representationTokenAddress: normalizeAddress(
      getRequiredEnv(`CHAIN_${externalChainId}_REPRESENTATION_TOKEN_ADDRESS`),
      "representation token"
    ),
    stratoBridgeAddress: normalizeAddress(
      getRequiredEnv("STRATO_NATIVE_BRIDGE_ADDRESS"),
      "STRATO native bridge"
    ),
    stratoVaultAddress: normalizeAddress(
      getRequiredEnv("STRATO_NATIVE_CUSTODY_VAULT_ADDRESS"),
      "STRATO native custody vault"
    ),
    stratoTokenAddress: normalizeAddress(
      getRequiredEnv("STRATO_TOKEN_ADDRESS"),
      "STRATO token"
    ),
    externalRecipientAddress: normalizeAddress(
      getRequiredEnv("EXTERNAL_RECIPIENT_ADDRESS"),
      "external recipient"
    ),
    stratoWithdrawerAddress: normalizeAddress(
      getRequiredEnv("STRATO_WITHDRAWER_ADDRESS"),
      "STRATO withdrawer"
    ),
    stratoUsername: getRequiredEnv("STRATO_WITHDRAWER_NAME"),
    stratoPassword: getRequiredEnv("STRATO_WITHDRAWER_PASSWORD"),
    withdrawalAmount: BigInt(getRequiredEnv("WITHDRAWAL_AMOUNT_WEI")),
    pollIntervalMs: Number(process.env.HAPPY_PATH_POLL_INTERVAL_MS || "10000"),
    timeoutMs: Number(process.env.HAPPY_PATH_TIMEOUT_MS || "900000"),
    nodeUrl: getRequiredEnv("NODE_URL").replace(/\/$/, ""),
    oauthUrl: getRequiredEnv("OAUTH_URL"),
    oauthClientId: getRequiredEnv("OAUTH_CLIENT_ID"),
    oauthClientSecret: getRequiredEnv("OAUTH_CLIENT_SECRET"),
  };
}

let cachedStratoToken;

async function getStratoAccessToken(cfg) {
  if (cachedStratoToken) return cachedStratoToken;

  const discovery = await axios.get(cfg.oauthUrl, {
    headers: { "Content-Type": "application/json" },
  });
  const tokenEndpoint = discovery.data && discovery.data.token_endpoint;
  if (!tokenEndpoint) {
    throw new Error(`OAuth discovery document missing token_endpoint: ${cfg.oauthUrl}`);
  }

  const response = await axios.post(
    tokenEndpoint,
    new URLSearchParams({
      grant_type: "password",
      client_id: cfg.oauthClientId,
      client_secret: cfg.oauthClientSecret,
      username: cfg.stratoUsername,
      password: cfg.stratoPassword,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  const accessToken = response.data && response.data.access_token;
  if (!accessToken) {
    throw new Error("OAuth token response missing access_token");
  }

  cachedStratoToken = accessToken;
  return cachedStratoToken;
}

async function cirrusSearch(cfg, tableName, params = {}) {
  const token = await getStratoAccessToken(cfg);
  const url = `${cfg.nodeUrl}/cirrus/search/${tableName}`;
  const { data } = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    params,
  });
  return data;
}

async function getStratoTokenBalance(cfg, holderAddress) {
  const rows = await cirrusSearch(cfg, "BlockApps-Token-_balances", {
    address: `eq.${toCirrusAddress(cfg.stratoTokenAddress, "STRATO token")}`,
    key: `eq.${toCirrusAddress(holderAddress, "STRATO balance holder")}`,
    select: "balance:value::text",
    limit: 1,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0n;
  }
  return BigInt(rows[0].balance || "0");
}

async function getVaultLockedBalance(cfg) {
  const rows = await cirrusSearch(cfg, "BlockApps-StratoNativeCustodyVault-lockedBalance", {
    address: `eq.${toCirrusAddress(cfg.stratoVaultAddress, "STRATO native custody vault")}`,
    key: `eq.${toCirrusAddress(cfg.stratoTokenAddress, "STRATO token")}`,
    select: "lockedBalance:value::text",
    limit: 1,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0n;
  }
  return BigInt(rows[0].lockedBalance || "0");
}

async function callContract(tokenObj, address, name, method, args) {
  const response = await rest.call(
    tokenObj,
    {
      contract: { address, name },
      method,
      args,
      txParams: {
        gasPrice: config.gasPrice,
        gasLimit: config.gasLimit,
      },
    },
    { config, cacheNonce: true, isAsync: true }
  );
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((item) => item && item.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error(
      `rest.call returned no tx hash for ${name}.${method}: ${JSON.stringify(response)}`
    );
  }

  const finalResults = await util.until(
    (results) =>
      Array.isArray(results) &&
      results.length > 0 &&
      results.every((result) => result && result.status && result.status !== "Pending"),
    (options) => rest.getBlocResults(tokenObj, hashes, options),
    { config, isAsync: true },
    60000
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== "Success") {
    throw new Error(
      `Contract call failed for ${name}.${method}: ${JSON.stringify(final || finalResults)}`
    );
  }

  return final;
}

async function findNativeWithdrawal(cfg) {
  const rows = await cirrusSearch(cfg, "BlockApps-StratoNativeBridge-withdrawals", {
    address: `eq.${toCirrusAddress(cfg.stratoBridgeAddress, "STRATO native bridge")}`,
    select: "key,value,block_timestamp",
    order: "block_timestamp.desc",
    limit: 100,
  });

  if (!Array.isArray(rows)) {
    return null;
  }

  const expectedRecipient = toCirrusAddress(
    cfg.externalRecipientAddress,
    "external recipient"
  );
  const expectedSender = toCirrusAddress(
    cfg.stratoWithdrawerAddress,
    "STRATO withdrawer"
  );
  const expectedToken = toCirrusAddress(cfg.stratoTokenAddress, "STRATO token");
  const expectedRepresentationToken = toCirrusAddress(
    cfg.representationTokenAddress,
    "representation token"
  );

  return (
    rows.find((row) => {
      const value = row && row.value;
      if (!value) return false;
      return (
        String(value.externalChainId) === cfg.externalChainId &&
        stripHexPrefixLower(value.externalRecipient) === expectedRecipient &&
        stripHexPrefixLower(value.stratoSender) === expectedSender &&
        stripHexPrefixLower(value.stratoToken) === expectedToken &&
        stripHexPrefixLower(value.representationToken) === expectedRepresentationToken &&
        String(value.stratoTokenAmount || "") === cfg.withdrawalAmount.toString()
      );
    }) || null
  );
}

async function main() {
  const cfg = buildConfig();
  if (cfg.withdrawalAmount <= 0n) {
    throw new Error("WITHDRAWAL_AMOUNT_WEI must be greater than zero");
  }

  console.log("Native withdrawal happy-path plan:");
  console.log(
    JSON.stringify(
      {
        externalChainId: cfg.externalChainId,
        stratoBridge: cfg.stratoBridgeAddress,
        stratoVault: cfg.stratoVaultAddress,
        stratoToken: cfg.stratoTokenAddress,
        stratoWithdrawer: cfg.stratoWithdrawerAddress,
        externalRecipient: cfg.externalRecipientAddress,
        representationToken: cfg.representationTokenAddress,
        withdrawalAmountWei: cfg.withdrawalAmount.toString(),
        timeoutMs: cfg.timeoutMs,
        pollIntervalMs: cfg.pollIntervalMs,
      },
      null,
      2
    )
  );

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(cfg.externalChainId)) {
    throw new Error(
      `RPC chain mismatch: expected ${cfg.externalChainId}, got ${network.chainId.toString()}`
    );
  }

  const representationToken = new ethers.Contract(
    cfg.representationTokenAddress,
    REPRESENTATION_TOKEN_ABI,
    provider
  );
  const tokenObj = {
    token: await auth.getUserToken(cfg.stratoUsername, cfg.stratoPassword),
  };

  const [
    tokenSymbol,
    stratoBalanceBefore,
    vaultLockedBefore,
    externalBalanceBefore,
  ] = await Promise.all([
    representationToken.symbol(),
    getStratoTokenBalance(cfg, cfg.stratoWithdrawerAddress),
    getVaultLockedBalance(cfg),
    representationToken.balanceOf(cfg.externalRecipientAddress),
  ]);

  logSection("Preflight");
  console.log(`STRATO withdrawer: ${cfg.stratoWithdrawerAddress}`);
  console.log(`STRATO balance before: ${stratoBalanceBefore.toString()}`);
  console.log(`STRATO vault locked before: ${vaultLockedBefore.toString()}`);
  console.log(`Sepolia recipient: ${cfg.externalRecipientAddress}`);
  console.log(`Representation token: ${tokenSymbol} (${cfg.representationTokenAddress})`);
  console.log(`Sepolia recipient balance before: ${externalBalanceBefore.toString()}`);

  if (stratoBalanceBefore < cfg.withdrawalAmount) {
    throw new Error(
      `STRATO withdrawer balance too low: need ${cfg.withdrawalAmount}, have ${stratoBalanceBefore}`
    );
  }

  logSection("Approve Custody Vault");
  const approveResult = await callContract(
    tokenObj,
    cfg.stratoTokenAddress,
    "Token",
    "approve",
    {
      spender: cfg.stratoVaultAddress,
      value: cfg.withdrawalAmount.toString(),
    }
  );
  console.log(`Approve tx: ${approveResult.hash || "(submitted)"}`);

  logSection("Request Withdrawal");
  const withdrawalResult = await callContract(
    tokenObj,
    cfg.stratoBridgeAddress,
    "StratoNativeBridge",
    "requestWithdrawal",
    {
      externalChainId: cfg.externalChainId,
      externalRecipient: cfg.externalRecipientAddress,
      stratoToken: cfg.stratoTokenAddress,
      stratoTokenAmount: cfg.withdrawalAmount.toString(),
    }
  );
  console.log(`Withdrawal request tx: ${withdrawalResult.hash || "(submitted)"}`);

  logSection("Wait For Bridge Service");
  const deadline = Date.now() + cfg.timeoutMs;
  let lastStatus = null;
  let lastExternalTxHash = null;

  while (Date.now() < deadline) {
    const [withdrawalRow, externalBalanceNow, vaultLockedNow] = await Promise.all([
      findNativeWithdrawal(cfg),
      representationToken.balanceOf(cfg.externalRecipientAddress),
      getVaultLockedBalance(cfg),
    ]);

    if (withdrawalRow) {
      const status = String(withdrawalRow.value.bridgeStatus);
      const externalTxHash = String(withdrawalRow.value.externalTxHash || "");

      if (status !== lastStatus || externalTxHash !== lastExternalTxHash) {
        console.log(
          `Observed STRATO withdrawal ${withdrawalRow.key}: status=${status}, externalTxHash=${externalTxHash || "(none)"}`
        );
        lastStatus = status;
        lastExternalTxHash = externalTxHash;
      }

      if (status === ABORTED_STATUS) {
        throw new Error(`STRATO native withdrawal was aborted: ${withdrawalRow.key}`);
      }

      if (status === COMPLETED_STATUS) {
        const externalDelta = externalBalanceNow - externalBalanceBefore;
        if (externalDelta !== cfg.withdrawalAmount) {
          throw new Error(
            `Sepolia recipient balance delta mismatch after completion: expected ${cfg.withdrawalAmount}, got ${externalDelta}`
          );
        }

        console.log(`Sepolia recipient balance after: ${externalBalanceNow.toString()}`);
        console.log(`STRATO vault locked after: ${vaultLockedNow.toString()}`);
        console.log(`Minted amount observed on Sepolia: ${externalDelta.toString()}`);
        logSection("Result");
        console.log("Happy-path native withdrawal completed successfully.");
        return;
      }
    }

    await sleep(cfg.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for STRATO withdrawal completion after ${cfg.timeoutMs} ms`
  );
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
