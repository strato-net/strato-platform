/**
 * State-changing happy-path runner for the native redemption flow:
 * Sepolia representation token -> bridge service -> STRATO unlock.
 *
 * This script:
 * 1. Checks the Sepolia holder balance and STRATO vault locked balance
 * 2. Approves the representation bridge if needed
 * 3. Calls requestRedemption() on Sepolia
 * 4. Waits for the bridge service to record + confirm the deposit on STRATO
 * 5. Verifies the STRATO recipient balance increases by the redemption amount
 */
const path = require("path");
require("dotenv").config({
  path:
    process.env.HAPPY_NATIVE_REDEMPTION_ENV_FILE ||
    path.resolve(__dirname, "../.env.happy-native-redemption"),
});

const axios = require("axios");
const { ethers } = require("ethers");

const DEFAULT_EXTERNAL_CHAIN_ID = "11155111";
const COMPLETED_STATUS = "3";
const ABORTED_STATUS = "4";

const TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
];

const REPRESENTATION_BRIDGE_ABI = [
  "function requestRedemption(address representationToken, uint256 amount, address stratoRecipient) external",
  "event RedemptionRequested(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId)",
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
  } catch (error) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function toCirrusAddress(address, label) {
  return normalizeAddress(address, label).toLowerCase().replace(/^0x/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBigInt(value) {
  return value.toString();
}

function logSection(title) {
  console.log(`\n== ${title} ==`);
}

function formatAxiosError(error, context) {
  if (!error || !error.isAxiosError) {
    return error && error.message ? error.message : String(error);
  }

  const status = error.response && error.response.status;
  const statusText = error.response && error.response.statusText;
  const method = error.config && error.config.method ? error.config.method.toUpperCase() : "REQUEST";
  const url = error.config && error.config.url;
  const responseData = error.response && error.response.data;
  const responsePreview = responseData
    ? typeof responseData === "string"
      ? responseData.slice(0, 300)
      : JSON.stringify(responseData).slice(0, 300)
    : "";

  return `${context} failed: ${method} ${url || "<unknown url>"} -> ${status || "no status"}${statusText ? ` ${statusText}` : ""}${responsePreview ? `; response=${responsePreview}` : ""}`;
}

function isSuccessfulReceipt(receipt) {
  return receipt && Number(receipt.status) === 1;
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
    representationBridgeAddress: normalizeAddress(
      getRequiredEnv(`CHAIN_${externalChainId}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`),
      "native representation bridge"
    ),
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
    stratoRecipientAddress: normalizeAddress(
      getRequiredEnv("STRATO_RECIPIENT_ADDRESS"),
      "STRATO recipient"
    ),
    representationHolderPrivateKey: getRequiredEnv("REPRESENTATION_HOLDER_PRIVATE_KEY"),
    redemptionAmount: BigInt(getRequiredEnv("REDEMPTION_AMOUNT_WEI")),
    pollIntervalMs: Number(process.env.HAPPY_PATH_POLL_INTERVAL_MS || "10000"),
    timeoutMs: Number(process.env.HAPPY_PATH_TIMEOUT_MS || "600000"),
    nodeUrl: getRequiredEnv("NODE_URL").replace(/\/$/, ""),
    oauthUrl: getRequiredEnv("OAUTH_URL"),
    oauthClientId: getRequiredEnv("OAUTH_CLIENT_ID"),
    oauthClientSecret: getRequiredEnv("OAUTH_CLIENT_SECRET"),
    stratoUsername: getRequiredEnv("GLOBAL_ADMIN_NAME"),
    stratoPassword: getRequiredEnv("GLOBAL_ADMIN_PASSWORD"),
  };
}

let cachedStratoToken;
let pendingStratoToken;

async function getStratoAccessToken(config) {
  if (cachedStratoToken) return cachedStratoToken;
  if (pendingStratoToken) return pendingStratoToken;

  pendingStratoToken = (async () => {
    let discovery;
    try {
      discovery = await axios.get(config.oauthUrl, {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      throw new Error(formatAxiosError(error, "OAuth discovery"));
    }
    const tokenEndpoint = discovery.data && discovery.data.token_endpoint;
    if (!tokenEndpoint) {
      throw new Error(`OAuth discovery document missing token_endpoint: ${config.oauthUrl}`);
    }

    let response;
    try {
      response = await axios.post(
        tokenEndpoint,
        new URLSearchParams({
          grant_type: "password",
          client_id: config.oauthClientId,
          client_secret: config.oauthClientSecret,
          username: config.stratoUsername,
          password: config.stratoPassword,
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );
    } catch (error) {
      throw new Error(formatAxiosError(error, "OAuth token request"));
    }

    const accessToken = response.data && response.data.access_token;
    if (!accessToken) {
      throw new Error("OAuth token response missing access_token");
    }

    cachedStratoToken = accessToken;
    return cachedStratoToken;
  })();

  try {
    return await pendingStratoToken;
  } finally {
    pendingStratoToken = undefined;
  }
}

async function cirrusSearch(config, tableName, params = {}) {
  const token = await getStratoAccessToken(config);
  const url = `${config.nodeUrl}/cirrus/search/${tableName}`;
  let response;
  try {
    response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      params,
    });
  } catch (error) {
    throw new Error(formatAxiosError(error, `Cirrus search ${tableName}`));
  }
  const { data } = response;
  return data;
}

async function getStratoTokenBalance(config, holderAddress) {
  const rows = await cirrusSearch(config, "BlockApps-Token-_balances", {
    address: `eq.${toCirrusAddress(config.stratoTokenAddress, "STRATO token")}`,
    key: `eq.${toCirrusAddress(holderAddress, "STRATO balance holder")}`,
    select: "balance:value::text",
    limit: 1,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0n;
  }

  return BigInt(rows[0].balance || "0");
}

async function getVaultLockedBalance(config) {
  const rows = await cirrusSearch(config, "BlockApps-StratoNativeCustodyVault-lockedBalance", {
    address: `eq.${toCirrusAddress(config.stratoVaultAddress, "STRATO native custody vault")}`,
    key: `eq.${toCirrusAddress(config.stratoTokenAddress, "STRATO token")}`,
    select: "lockedBalance:value::text",
    limit: 1,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return 0n;
  }

  return BigInt(rows[0].lockedBalance || "0");
}

async function findNativeDeposit(config, redemptionId) {
  const rows = await cirrusSearch(config, "BlockApps-StratoNativeBridge-deposits", {
    address: `eq.${toCirrusAddress(config.stratoBridgeAddress, "STRATO native bridge")}`,
    select: "key,value,block_timestamp",
    limit: 100,
  });

  if (!Array.isArray(rows)) {
    return null;
  }

  const expectedBridge = toCirrusAddress(
    config.representationBridgeAddress,
    "representation bridge"
  );
  const expectedRecipient = toCirrusAddress(
    config.stratoRecipientAddress,
    "STRATO recipient"
  );

  return (
    rows.find((row) => {
      const value = row && row.value;
      if (!value) return false;
      return (
        String(value.externalChainId) === config.externalChainId &&
        String(value.externalRedemptionId) === String(redemptionId) &&
        String(value.externalBridge || "").toLowerCase() === expectedBridge &&
        String(value.representationToken || "").toLowerCase() ===
          toCirrusAddress(config.representationTokenAddress, "representation token") &&
        String(value.stratoRecipient || "").toLowerCase() === expectedRecipient
      );
    }) || null
  );
}

async function ensureApproval(config, wallet, token, bridgeAddress) {
  const allowance = await token.allowance(wallet.address, bridgeAddress);
  if (allowance >= config.redemptionAmount) {
    return null;
  }

  const tx = await token.approve(bridgeAddress, config.redemptionAmount);
  const receipt = await tx.wait();
  if (!isSuccessfulReceipt(receipt)) {
    throw new Error("Approval transaction failed");
  }
  return receipt.hash;
}

function parseRedemptionEvent(receipt, bridgeInterface) {
  for (const log of receipt.logs || []) {
    try {
      const parsed = bridgeInterface.parseLog(log);
      if (parsed && parsed.name === "RedemptionRequested") {
        return {
          representationToken: parsed.args.representationToken,
          amount: parsed.args.amount,
          sender: parsed.args.sender,
          stratoRecipient: parsed.args.stratoRecipient,
          redemptionId: parsed.args.redemptionId,
        };
      }
    } catch (_error) {
      // Ignore unrelated logs.
    }
  }
  return null;
}

async function main() {
  const config = buildConfig();
  if (config.redemptionAmount <= 0n) {
    throw new Error("REDEMPTION_AMOUNT_WEI must be greater than zero");
  }

  console.log("Native redemption happy-path plan:");
  console.log(
    JSON.stringify(
      {
        externalChainId: config.externalChainId,
        representationBridge: config.representationBridgeAddress,
        representationToken: config.representationTokenAddress,
        stratoBridge: config.stratoBridgeAddress,
        stratoVault: config.stratoVaultAddress,
        stratoToken: config.stratoTokenAddress,
        stratoRecipient: config.stratoRecipientAddress,
        redemptionAmountWei: config.redemptionAmount.toString(),
        timeoutMs: config.timeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      },
      null,
      2
    )
  );

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(config.externalChainId)) {
    throw new Error(
      `RPC chain mismatch: expected ${config.externalChainId}, got ${network.chainId.toString()}`
    );
  }

  const holderWallet = new ethers.Wallet(
    config.representationHolderPrivateKey,
    provider
  );
  const token = new ethers.Contract(
    config.representationTokenAddress,
    TOKEN_ABI,
    holderWallet
  );
  const bridge = new ethers.Contract(
    config.representationBridgeAddress,
    REPRESENTATION_BRIDGE_ABI,
    holderWallet
  );
  const bridgeInterface = bridge.interface;

  const [
    tokenSymbol,
    holderBalanceBefore,
    recipientBalanceBefore,
    vaultLockedBefore,
  ] = await Promise.all([
    token.symbol(),
    token.balanceOf(holderWallet.address),
    getStratoTokenBalance(config, config.stratoRecipientAddress),
    getVaultLockedBalance(config),
  ]);

  logSection("Preflight");
  console.log(`Sepolia holder: ${holderWallet.address}`);
  console.log(`Representation token: ${tokenSymbol} (${config.representationTokenAddress})`);
  console.log(`Holder balance before: ${formatBigInt(holderBalanceBefore)}`);
  console.log(`STRATO recipient balance before: ${formatBigInt(recipientBalanceBefore)}`);
  console.log(`STRATO vault locked balance before: ${formatBigInt(vaultLockedBefore)}`);

  if (holderBalanceBefore < config.redemptionAmount) {
    throw new Error(
      `Representation holder balance too low: need ${config.redemptionAmount}, have ${holderBalanceBefore}`
    );
  }
  if (vaultLockedBefore < config.redemptionAmount) {
    throw new Error(
      `STRATO vault locked balance too low: need ${config.redemptionAmount}, have ${vaultLockedBefore}`
    );
  }

  const approvalHash = await ensureApproval(
    config,
    holderWallet,
    token,
    config.representationBridgeAddress
  );
  if (approvalHash) {
    console.log(`Approval tx: ${approvalHash}`);
  } else {
    console.log("Approval: existing allowance already sufficient");
  }

  logSection("Submit Redemption");
  const redemptionTx = await bridge.requestRedemption(
    config.representationTokenAddress,
    config.redemptionAmount,
    config.stratoRecipientAddress
  );
  const redemptionReceipt = await redemptionTx.wait();
  if (!isSuccessfulReceipt(redemptionReceipt)) {
    throw new Error("requestRedemption transaction failed");
  }

  const event = parseRedemptionEvent(redemptionReceipt, bridgeInterface);
  if (!event) {
    throw new Error("RedemptionRequested event not found in receipt");
  }

  console.log(`Redemption tx: ${redemptionReceipt.hash}`);
  console.log(`Redemption id: ${event.redemptionId.toString()}`);
  console.log(`Redemption sender: ${event.sender}`);
  console.log(`Redemption recipient: ${event.stratoRecipient}`);
  console.log(`Redemption amount: ${event.amount.toString()}`);

  const holderBalanceAfterTx = await token.balanceOf(holderWallet.address);
  if (holderBalanceBefore - holderBalanceAfterTx !== config.redemptionAmount) {
    throw new Error(
      `Representation balance delta mismatch: expected ${config.redemptionAmount}, got ${holderBalanceBefore - holderBalanceAfterTx}`
    );
  }

  logSection("Wait For Bridge Service");
  const deadline = Date.now() + config.timeoutMs;
  let lastDepositStatus = null;

  while (Date.now() < deadline) {
    const [depositRow, recipientBalanceNow, vaultLockedNow] = await Promise.all([
      findNativeDeposit(config, event.redemptionId.toString()),
      getStratoTokenBalance(config, config.stratoRecipientAddress),
      getVaultLockedBalance(config),
    ]);

    if (depositRow) {
      const status = String(depositRow.value.bridgeStatus);
      if (status !== lastDepositStatus) {
        console.log(
          `Observed STRATO deposit status ${status} for depositId ${depositRow.key}`
        );
        lastDepositStatus = status;
      }

      if (status === ABORTED_STATUS) {
        throw new Error(`STRATO native deposit was aborted for redemption ${event.redemptionId}`);
      }

      const recipientDelta = recipientBalanceNow - recipientBalanceBefore;
      if (status === COMPLETED_STATUS) {
        if (recipientDelta !== config.redemptionAmount) {
          throw new Error(
            `Recipient balance delta mismatch after completion: expected ${config.redemptionAmount}, got ${recipientDelta}`
          );
        }

        console.log(`STRATO recipient balance after: ${formatBigInt(recipientBalanceNow)}`);
        console.log(`STRATO vault locked balance after: ${formatBigInt(vaultLockedNow)}`);
        console.log(`Unlocked amount observed on STRATO: ${formatBigInt(recipientDelta)}`);

        logSection("Result");
        console.log("Happy-path redemption completed successfully.");
        return;
      }
    }

    await sleep(config.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for STRATO deposit completion after ${config.timeoutMs} ms`
  );
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
