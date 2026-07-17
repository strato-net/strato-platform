#!/usr/bin/env node

/**
 * Read-only inspector for a live YieldVault deployment on STRATO testnet/mainnet.
 *
 * Defaults to the live Helium ETH carry vault address:
 *   0x8c0f17df514efaee2baf1e59923fff700c5ca2b7
 *
 * Auth:
 * - ACCESS_TOKEN env var, or
 * - ~/.secrets/stratoToken produced by `strato-auth`
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const DEFAULT_BASE_URL = process.env.NODE_URL || "https://app.testnet.strato.nexus";
const DEFAULT_VAULT = (process.env.VAULT_ADDRESS || "8c0f17df514efaee2baf1e59923fff700c5ca2b7")
  .toLowerCase()
  .replace(/^0x/, "");

function readToken() {
  if (process.env.ACCESS_TOKEN) return process.env.ACCESS_TOKEN;
  const tokenFile = path.join(os.homedir(), ".secrets", "stratoToken");
  const raw = fs.readFileSync(tokenFile, "utf8");
  return JSON.parse(raw).access_token;
}

function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Failed to parse JSON from ${url}: ${error.message}\n${body}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function pretty(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

async function main() {
  const token = readToken();
  const base = DEFAULT_BASE_URL.replace(/\/$/, "");
  const vault = DEFAULT_VAULT;

  const vaultUrl = `${base}/cirrus/search/BlockApps-YieldVault?address=eq.${vault}`;
  const strategyUrl = `${base}/cirrus/search/BlockApps-YieldVault-approvedStrategies?address=eq.${vault}`;
  const debtUrl = `${base}/cirrus/search/BlockApps-YieldVault-strategyDebt?address=eq.${vault}`;
  const queueUrl = `${base}/cirrus/search/BlockApps-YieldVault-requests?address=eq.${vault}`;
  const ownerUrl = `${base}/cirrus/search/BlockApps-YieldVault-requestOwner?address=eq.${vault}`;
  const claimUrl = `${base}/cirrus/search/BlockApps-YieldVault-claimableAssets?address=eq.${vault}`;
  const shareBalUrl = `${base}/cirrus/search/BlockApps-YieldVault-_balances?address=eq.${vault}`;

  const [vaultRows, strategyRows, debtRows, queueRows, ownerRows, claimRows, shareRows] =
    await Promise.all([
      getJson(vaultUrl, token),
      getJson(strategyUrl, token),
      getJson(debtUrl, token),
      getJson(queueUrl, token),
      getJson(ownerUrl, token),
      getJson(claimUrl, token),
      getJson(shareBalUrl, token),
    ]);

  if (!Array.isArray(vaultRows) || vaultRows.length === 0) {
    console.error(`Vault ${vault} not found`);
    process.exit(1);
  }

  const row = vaultRows[0];
  const asset = row._asset;
  const assetRows = await getJson(`${base}/cirrus/search/BlockApps-Token?address=eq.${asset}`, token);
  const assetBalRows = await getJson(
    `${base}/cirrus/search/BlockApps-Token-_balances?address=eq.${asset}&key=eq.${vault}`,
    token
  );

  console.log("## Live Vault");
  console.log(`address: ${row.address}`);
  console.log(`name: ${row._name}`);
  console.log(`symbol: ${row._symbol}`);
  console.log(`asset: ${asset}`);
  console.log(`asset_symbol: ${assetRows?.[0]?._symbol || "unknown"}`);
  console.log(`owner: ${row._owner}`);
  console.log(`paused: ${row._paused}`);
  console.log(`vaultInitialized: ${row.vaultInitialized}`);
  console.log(`underlyingDecimals: ${row._underlyingDecimals}`);
  console.log(`totalSupply: ${row._totalSupply}`);
  console.log(`deployedAssets: ${row.deployedAssets}`);
  console.log(`minIdleBps: ${row.minIdleBps}`);
  console.log(`queueHead: ${row.queueHead}`);
  console.log(`queueTail: ${row.queueTail}`);
  console.log(`nextRequestId: ${row.nextRequestId}`);
  console.log(`totalQueuedShares: ${row.totalQueuedShares}`);
  console.log(`totalClaimableAssets: ${row.totalClaimableAssets}`);
  console.log(`idleAssetBalance: ${assetBalRows?.[0]?.value || "0"}`);
  console.log("");

  console.log("## Mappings");
  console.log(`approvedStrategies: ${pretty(strategyRows)}`);
  console.log(`strategyDebt: ${pretty(debtRows)}`);
  console.log(`requests: ${pretty(queueRows)}`);
  console.log(`requestOwner: ${pretty(ownerRows)}`);
  console.log(`claimableAssets: ${pretty(claimRows)}`);
  console.log(`shareBalances: ${pretty(shareRows)}`);
  console.log("");

  console.log("## Suggested Next Calls");
  if (!strategyRows.length) {
    console.log("- `setStrategyApproval(strategyAddress, true)`");
  }
  if ((row.minIdleBps || 0) === 0) {
    console.log("- `setMinIdleBps(<bufferBps>)`");
  }
  if (String(row._totalSupply) === "0") {
    console.log("- first depositor(s): `deposit(assets, receiver)`");
    console.log("- after deposits and strategy approval: owner `deployCapital(strategy, assets)`");
  } else {
    if (String(row.totalQueuedShares) !== "0") {
      console.log("- queue exists: return liquidity, then `processQueue(maxRequests, maxAssets)`");
      console.log("- queued users then call `claim(receiver)`");
    } else if (strategyRows.length && String(row.deployedAssets) === "0") {
      console.log("- if there is idle to deploy: owner `deployCapital(strategy, assets)`");
    } else if (String(row.deployedAssets) !== "0") {
      console.log("- strategy running: later `returnCapital(strategy, assetsReturned)`");
      console.log("- if assetsReturned > strategyDebt[strategy], excess is realized profit");
      console.log("- if strategy under-returns, use `reportStrategyLoss(strategy, loss)`");
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
