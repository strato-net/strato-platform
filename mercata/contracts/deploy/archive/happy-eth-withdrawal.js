/**
 * State-changing smoke runner for the existing non-native ETH bridge-out flow:
 * STRATO mapped token -> MercataBridge -> Sepolia ETH Safe proposal or execution.
 *
 * This script:
 * 1. Checks the STRATO withdrawer mapped-token balance and Sepolia recipient ETH balance
 * 2. Approves MercataBridge to pull the mapped STRATO token
 * 3. Calls MercataBridge.requestWithdrawal(...) for Sepolia ETH
 * 4. Waits until the bridge service records a manual Safe tx hash or completes the withdrawal
 */
const path = require("path");
require("dotenv").config({
  path:
    process.env.HAPPY_ETH_WITHDRAWAL_ENV_FILE ||
    path.resolve(__dirname, "../.env.happy-eth-withdrawal"),
});

const axios = require("axios");
const { ethers } = require("ethers");
const config = require("../config");
const auth = require("../auth");
const { rest, util } = require("blockapps-rest");

const DEFAULT_EXTERNAL_CHAIN_ID = "11155111";
const ETH_EXTERNAL_TOKEN = "0x0000000000000000000000000000000000000000";
const DEFAULT_STRATO_ETH_TOKEN = "0x93fb7295859b2d70199e0a4883b7c320cf874e6c";
const PENDING_REVIEW_STATUS = "2";
const COMPLETED_STATUS = "3";
const ABORTED_STATUS = "4";

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
    bridgeAddress: normalizeAddress(getRequiredEnv("BRIDGE_ADDRESS"), "MercataBridge"),
    stratoTokenAddress: normalizeAddress(
      process.env.STRATO_ETH_TOKEN_ADDRESS || DEFAULT_STRATO_ETH_TOKEN,
      "STRATO ETH token"
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
    requireManual: process.env.REQUIRE_MANUAL_WITHDRAWAL !== "false",
    pollIntervalMs: Number(process.env.HAPPY_PATH_POLL_INTERVAL_MS || "10000"),
    timeoutMs: Number(process.env.HAPPY_PATH_TIMEOUT_MS || "600000"),
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
    address: `eq.${toCirrusAddress(cfg.stratoTokenAddress, "STRATO ETH token")}`,
    key: `eq.${toCirrusAddress(holderAddress, "STRATO balance holder")}`,
    select: "balance:value::text",
    limit: 1,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0n;
  }
  return BigInt(rows[0].balance || "0");
}

async function getHotWithdrawalThreshold(cfg) {
  const rows = await cirrusSearch(cfg, "BlockApps-MercataBridge-hotWithdrawalThresholds", {
    address: `eq.${toCirrusAddress(cfg.bridgeAddress, "MercataBridge")}`,
    key: `eq.${cfg.externalChainId}`,
    key2: `eq.${toCirrusAddress(ETH_EXTERNAL_TOKEN, "ETH external token")}`,
    select: "threshold:value::text",
    limit: 1,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0n;
  }
  return BigInt(rows[0].threshold || "0");
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

async function findEthWithdrawal(cfg) {
  const rows = await cirrusSearch(cfg, "BlockApps-MercataBridge-withdrawals", {
    address: `eq.${toCirrusAddress(cfg.bridgeAddress, "MercataBridge")}`,
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
  const expectedStratoToken = toCirrusAddress(cfg.stratoTokenAddress, "STRATO token");
  const expectedExternalToken = toCirrusAddress(ETH_EXTERNAL_TOKEN, "ETH external token");

  return (
    rows.find((row) => {
      const value = row && row.value;
      if (!value) return false;
      return (
        String(value.externalChainId) === cfg.externalChainId &&
        stripHexPrefixLower(value.externalRecipient) === expectedRecipient &&
        stripHexPrefixLower(value.stratoSender) === expectedSender &&
        stripHexPrefixLower(value.stratoToken) === expectedStratoToken &&
        stripHexPrefixLower(value.externalToken) === expectedExternalToken &&
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

  console.log("Non-native ETH withdrawal smoke plan:");
  console.log(
    JSON.stringify(
      {
        externalChainId: cfg.externalChainId,
        bridge: cfg.bridgeAddress,
        externalToken: ETH_EXTERNAL_TOKEN,
        externalName: "Ether",
        externalSymbol: "ETH",
        externalDecimals: "18",
        stratoToken: cfg.stratoTokenAddress,
        stratoWithdrawer: cfg.stratoWithdrawerAddress,
        externalRecipient: cfg.externalRecipientAddress,
        withdrawalAmountWei: cfg.withdrawalAmount.toString(),
        requireManualWithdrawal: cfg.requireManual,
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

  const tokenObj = {
    token: await auth.getUserToken(cfg.stratoUsername, cfg.stratoPassword),
  };

  const [stratoBalanceBefore, externalBalanceBefore, hotWithdrawalThreshold] = await Promise.all([
    getStratoTokenBalance(cfg, cfg.stratoWithdrawerAddress),
    provider.getBalance(cfg.externalRecipientAddress),
    getHotWithdrawalThreshold(cfg),
  ]);

  logSection("Preflight");
  console.log(`STRATO withdrawer: ${cfg.stratoWithdrawerAddress}`);
  console.log(`STRATO mapped ETH balance before: ${stratoBalanceBefore.toString()}`);
  console.log(`Sepolia recipient: ${cfg.externalRecipientAddress}`);
  console.log(`Sepolia ETH balance before: ${externalBalanceBefore.toString()}`);
  console.log(`ETH hot withdrawal threshold: ${hotWithdrawalThreshold.toString()}`);
  console.log(`Require manual withdrawal: ${String(cfg.requireManual)}`);

  if (stratoBalanceBefore < cfg.withdrawalAmount) {
    throw new Error(
      `STRATO withdrawer balance too low: need ${cfg.withdrawalAmount}, have ${stratoBalanceBefore}`
    );
  }
  if (cfg.requireManual && cfg.withdrawalAmount <= hotWithdrawalThreshold) {
    throw new Error(
      `Withdrawal amount is in the hot-wallet lane: amount=${cfg.withdrawalAmount}, threshold=${hotWithdrawalThreshold}. Use an amount greater than the threshold or set REQUIRE_MANUAL_WITHDRAWAL=false.`
    );
  }

  logSection("Approve MercataBridge");
  const approveResult = await callContract(
    tokenObj,
    cfg.stratoTokenAddress,
    "Token",
    "approve",
    {
      spender: cfg.bridgeAddress,
      value: cfg.withdrawalAmount.toString(),
    }
  );
  console.log(`Approve tx: ${approveResult.hash || "(submitted)"}`);

  logSection("Request ETH Withdrawal");
  const withdrawalResult = await callContract(
    tokenObj,
    cfg.bridgeAddress,
    "MercataBridge",
    "requestWithdrawal",
    {
      externalChainId: cfg.externalChainId,
      externalRecipient: cfg.externalRecipientAddress,
      externalToken: ETH_EXTERNAL_TOKEN,
      stratoToken: cfg.stratoTokenAddress,
      stratoTokenAmount: cfg.withdrawalAmount.toString(),
    }
  );
  console.log(`Withdrawal request tx: ${withdrawalResult.hash || "(submitted)"}`);

  logSection("Wait For Bridge Service");
  const deadline = Date.now() + cfg.timeoutMs;
  let lastStatus = null;
  let lastCustodyTxHash = null;

  while (Date.now() < deadline) {
    const [withdrawalRow, externalBalanceNow] = await Promise.all([
      findEthWithdrawal(cfg),
      provider.getBalance(cfg.externalRecipientAddress),
    ]);

    if (withdrawalRow) {
      const status = String(withdrawalRow.value.bridgeStatus);
      const custodyTxHash = String(withdrawalRow.value.custodyTxHash || "");
      const useHotWallet = String(withdrawalRow.value.useHotWallet) === "true";

      if (status !== lastStatus || custodyTxHash !== lastCustodyTxHash) {
        console.log(
          `Observed STRATO withdrawal ${withdrawalRow.key}: status=${status}, custodyTxHash=${custodyTxHash || "(none)"}, useHotWallet=${String(withdrawalRow.value.useHotWallet)}`
        );
        lastStatus = status;
        lastCustodyTxHash = custodyTxHash;
      }

      if (cfg.requireManual && useHotWallet) {
        throw new Error(
          `Withdrawal ${withdrawalRow.key} entered hot-wallet lane. Increase WITHDRAWAL_AMOUNT_WEI above the ETH hot threshold or set REQUIRE_MANUAL_WITHDRAWAL=false.`
        );
      }

      if (status === ABORTED_STATUS) {
        throw new Error(`ETH withdrawal was aborted: ${withdrawalRow.key}`);
      }

      if (status === COMPLETED_STATUS) {
        const externalDelta = externalBalanceNow - externalBalanceBefore;
        if (externalDelta !== cfg.withdrawalAmount) {
          throw new Error(
            `Sepolia ETH balance delta mismatch after completion: expected ${cfg.withdrawalAmount}, got ${externalDelta}`
          );
        }

        console.log(`Sepolia ETH balance after: ${externalBalanceNow.toString()}`);
        console.log(`Received ETH on Sepolia: ${externalDelta.toString()}`);
        logSection("Result");
        console.log("Non-native ETH withdrawal completed successfully.");
        return;
      }

      if (status === PENDING_REVIEW_STATUS && custodyTxHash) {
        console.log(`Safe transaction hash: ${custodyTxHash}`);
        logSection("Result");
        console.log("Non-native ETH withdrawal reached manual Safe proposal/pending-review state.");
        return;
      }
    }

    await sleep(cfg.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ETH withdrawal service processing after ${cfg.timeoutMs} ms`
  );
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
