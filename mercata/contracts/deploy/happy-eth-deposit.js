/**
 * State-changing smoke runner for the existing non-native ETH bridge-in flow:
 * Sepolia ETH -> DepositRouter -> bridge service -> STRATO mapped ETH token.
 *
 * This script:
 * 1. Checks Sepolia sender ETH and STRATO recipient mapped-token balances
 * 2. Calls DepositRouter.depositETH(stratoAddress, targetStratoToken)
 * 3. Waits for the bridge service to record and complete the STRATO deposit
 * 4. Verifies the STRATO mapped-token balance increases by the deposit amount
 */
const path = require("path");
require("dotenv").config({
  path:
    process.env.HAPPY_ETH_DEPOSIT_ENV_FILE ||
    path.resolve(__dirname, "../.env.happy-eth-deposit"),
});

const axios = require("axios");
const { ethers } = require("ethers");

const DEFAULT_EXTERNAL_CHAIN_ID = "11155111";
const ETH_EXTERNAL_TOKEN = "0x0000000000000000000000000000000000000000";
const DEFAULT_STRATO_ETH_TOKEN = "0x93fb7295859b2d70199e0a4883b7c320cf874e6c";
const COMPLETED_STATUS = "3";
const ABORTED_STATUS = "4";

const DEPOSIT_ROUTER_ABI = [
  "function depositETH(address stratoAddress, address targetStratoToken) payable",
  "function tokenConfig(address token) view returns (uint96 min, bool isPermitted)",
  "function routePermitted(address token, address targetStratoToken) view returns (bool)",
  "function gnosisSafe() view returns (address)",
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
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
    depositRouterAddress: normalizeAddress(
      getRequiredEnv(`CHAIN_${externalChainId}_DEPOSIT_ROUTER_ADDRESS`),
      "DepositRouter"
    ),
    bridgeAddress: normalizeAddress(getRequiredEnv("BRIDGE_ADDRESS"), "MercataBridge"),
    stratoTokenAddress: normalizeAddress(
      process.env.STRATO_ETH_TOKEN_ADDRESS || DEFAULT_STRATO_ETH_TOKEN,
      "STRATO ETH token"
    ),
    stratoRecipientAddress: normalizeAddress(
      getRequiredEnv("STRATO_RECIPIENT_ADDRESS"),
      "STRATO recipient"
    ),
    externalSenderPrivateKey: getRequiredEnv("EXTERNAL_SENDER_PRIVATE_KEY"),
    depositAmount: BigInt(getRequiredEnv("DEPOSIT_AMOUNT_WEI")),
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

async function findEthDeposit(cfg, externalTxHash) {
  const rows = await cirrusSearch(cfg, "BlockApps-MercataBridge-deposits", {
    address: `eq.${toCirrusAddress(cfg.bridgeAddress, "MercataBridge")}`,
    key: `eq.${cfg.externalChainId}`,
    select: "key,key2,value,block_timestamp",
    order: "block_timestamp.desc",
    limit: 100,
  });

  if (!Array.isArray(rows)) {
    return null;
  }

  const expectedTxHash = stripHexPrefixLower(externalTxHash);
  const expectedRecipient = toCirrusAddress(
    cfg.stratoRecipientAddress,
    "STRATO recipient"
  );
  const expectedStratoToken = toCirrusAddress(cfg.stratoTokenAddress, "STRATO token");
  const expectedExternalToken = toCirrusAddress(ETH_EXTERNAL_TOKEN, "ETH external token");

  return (
    rows.find((row) => {
      const value = row && row.value;
      if (!value) return false;
      return (
        stripHexPrefixLower(row.key2) === expectedTxHash &&
        stripHexPrefixLower(value.stratoRecipient) === expectedRecipient &&
        stripHexPrefixLower(value.stratoToken) === expectedStratoToken &&
        stripHexPrefixLower(value.externalToken) === expectedExternalToken
      );
    }) || null
  );
}

function parseDepositEvent(receipt, routerInterface) {
  for (const log of receipt.logs || []) {
    try {
      const parsed = routerInterface.parseLog(log);
      if (parsed && parsed.name === "DepositRouted") {
        return {
          token: parsed.args.token,
          amount: parsed.args.amount,
          sender: parsed.args.sender,
          stratoAddress: parsed.args.stratoAddress,
          targetStratoToken: parsed.args.targetStratoToken,
          depositId: parsed.args.depositId,
        };
      }
    } catch (_error) {
      // Ignore unrelated logs.
    }
  }
  return null;
}

async function main() {
  const cfg = buildConfig();
  if (cfg.depositAmount <= 0n) {
    throw new Error("DEPOSIT_AMOUNT_WEI must be greater than zero");
  }

  console.log("Non-native ETH deposit smoke plan:");
  console.log(
    JSON.stringify(
      {
        externalChainId: cfg.externalChainId,
        depositRouter: cfg.depositRouterAddress,
        bridge: cfg.bridgeAddress,
        externalToken: ETH_EXTERNAL_TOKEN,
        externalName: "Ether",
        externalSymbol: "ETH",
        externalDecimals: "18",
        stratoToken: cfg.stratoTokenAddress,
        stratoRecipient: cfg.stratoRecipientAddress,
        depositAmountWei: cfg.depositAmount.toString(),
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

  const externalWallet = new ethers.Wallet(cfg.externalSenderPrivateKey, provider);
  const router = new ethers.Contract(
    cfg.depositRouterAddress,
    DEPOSIT_ROUTER_ABI,
    externalWallet
  );
  const routerInterface = router.interface;

  const [
    externalBalanceBefore,
    stratoBalanceBefore,
    ethConfig,
    routePermitted,
    routerSafe,
  ] = await Promise.all([
    provider.getBalance(externalWallet.address),
    getStratoTokenBalance(cfg, cfg.stratoRecipientAddress),
    router.tokenConfig(ETH_EXTERNAL_TOKEN),
    router.routePermitted(ETH_EXTERNAL_TOKEN, cfg.stratoTokenAddress),
    router.gnosisSafe(),
  ]);

  logSection("Preflight");
  console.log(`Sepolia sender: ${externalWallet.address}`);
  console.log(`Sepolia sender ETH before: ${externalBalanceBefore.toString()}`);
  console.log(`DepositRouter Safe: ${routerSafe}`);
  console.log(`ETH min deposit: ${ethConfig.min.toString()}`);
  console.log(`ETH permitted: ${String(ethConfig.isPermitted)}`);
  console.log(`ETH -> STRATO token route permitted: ${String(routePermitted)}`);
  console.log(`STRATO recipient: ${cfg.stratoRecipientAddress}`);
  console.log(`STRATO mapped ETH balance before: ${stratoBalanceBefore.toString()}`);

  if (!ethConfig.isPermitted) {
    throw new Error("DepositRouter ETH tokenConfig is not permitted");
  }
  if (!routePermitted) {
    throw new Error("DepositRouter ETH route is not permitted for target STRATO token");
  }
  if (cfg.depositAmount < ethConfig.min) {
    throw new Error(
      `Deposit below DepositRouter minimum: need at least ${ethConfig.min}, got ${cfg.depositAmount}`
    );
  }

  logSection("Submit Sepolia ETH Deposit");
  const depositTx = await router.depositETH(
    cfg.stratoRecipientAddress,
    cfg.stratoTokenAddress,
    { value: cfg.depositAmount }
  );
  const depositReceipt = await depositTx.wait();
  if (!isSuccessfulReceipt(depositReceipt)) {
    throw new Error("DepositRouter.depositETH transaction failed");
  }

  const event = parseDepositEvent(depositReceipt, routerInterface);
  if (!event) {
    throw new Error("DepositRouted event not found in receipt");
  }

  console.log(`Sepolia deposit tx: ${depositReceipt.hash}`);
  console.log(`DepositRouter depositId: ${event.depositId.toString()}`);
  console.log(`Deposit sender: ${event.sender}`);
  console.log(`Deposit STRATO recipient: ${event.stratoAddress}`);
  console.log(`Deposit target STRATO token: ${event.targetStratoToken}`);
  console.log(`Deposit ETH amount: ${event.amount.toString()}`);

  if (event.amount !== cfg.depositAmount) {
    throw new Error(
      `Deposit event amount mismatch: expected ${cfg.depositAmount}, got ${event.amount}`
    );
  }

  logSection("Wait For Bridge Service");
  const deadline = Date.now() + cfg.timeoutMs;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const [depositRow, stratoBalanceNow] = await Promise.all([
      findEthDeposit(cfg, depositReceipt.hash),
      getStratoTokenBalance(cfg, cfg.stratoRecipientAddress),
    ]);

    if (depositRow) {
      const status = String(depositRow.value.bridgeStatus);

      if (status !== lastStatus) {
        console.log(
          `Observed STRATO deposit ${depositRow.key}:${depositRow.key2}: status=${status}`
        );
        lastStatus = status;
      }

      if (status === ABORTED_STATUS) {
        throw new Error(`ETH deposit was aborted for tx ${depositReceipt.hash}`);
      }

      if (status === COMPLETED_STATUS) {
        const stratoDelta = stratoBalanceNow - stratoBalanceBefore;
        if (stratoDelta !== cfg.depositAmount) {
          throw new Error(
            `STRATO balance delta mismatch after completion: expected ${cfg.depositAmount}, got ${stratoDelta}`
          );
        }

        console.log(`STRATO mapped ETH balance after: ${stratoBalanceNow.toString()}`);
        console.log(`Minted mapped ETH on STRATO: ${stratoDelta.toString()}`);
        logSection("Result");
        console.log("Non-native ETH deposit completed successfully.");
        return;
      }
    }

    await sleep(cfg.pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ETH deposit completion after ${cfg.timeoutMs} ms`
  );
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
