const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const DEFAULT_BASE_URL = process.env.NODE_URL || "https://app.testnet.strato.nexus";
const DEFAULT_VAULT_ADDRESS =
  (process.env.VAULT_ADDRESS || "8c0f17df514efaee2baf1e59923fff700c5ca2b7")
    .toLowerCase()
    .replace(/^0x/, "");
const WAD = 10n ** 18n;

function normalizeAddress(value) {
  return String(value || "").toLowerCase().replace(/^0x/, "");
}

function readToken() {
  if (process.env.ACCESS_TOKEN) return process.env.ACCESS_TOKEN;
  const tokenFile = path.join(os.homedir(), ".secrets", "stratoToken");
  const raw = fs.readFileSync(tokenFile, "utf8");
  return JSON.parse(raw).access_token;
}

function requestJson(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          let parsed = responseBody;
          try {
            parsed = responseBody ? JSON.parse(responseBody) : null;
          } catch {
            // keep raw text
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.body = parsed;
            reject(err);
            return;
          }

          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function buildSearchUrl(baseUrl, table, params = {}) {
  const base = baseUrl.replace(/\/$/, "");
  const url = new URL(`${base}/cirrus/search/${table}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function cirrusSearch(baseUrl, token, table, params = {}) {
  return requestJson("GET", buildSearchUrl(baseUrl, table, params), token);
}

async function getUser(baseUrl, token) {
  const base = baseUrl.replace(/\/$/, "");
  return requestJson("GET", `${base}/api/user/me`, token);
}

async function getVaultRow(baseUrl, token, vaultAddress = DEFAULT_VAULT_ADDRESS) {
  const rows = await cirrusSearch(baseUrl, token, "BlockApps-YieldVault", {
    address: `eq.${normalizeAddress(vaultAddress)}`,
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Vault not found: ${vaultAddress}`);
  }
  return rows[0];
}

async function getTokenBalance(baseUrl, token, tokenAddress, userAddress) {
  const rows = await cirrusSearch(baseUrl, token, "BlockApps-Token-_balances", {
    address: `eq.${normalizeAddress(tokenAddress)}`,
    key: `eq.${normalizeAddress(userAddress)}`,
  });
  return rows?.[0]?.value || "0";
}

async function sendFunctionTx(baseUrl, token, { contractName, contractAddress, method, args }) {
  const base = baseUrl.replace(/\/$/, "");
  const body = {
    txs: [
      {
        type: "FUNCTION",
        payload: {
          contractName,
          contractAddress: normalizeAddress(contractAddress),
          method,
          args,
        },
      },
    ],
    txParams: {
      gasLimit: 32100000000,
      gasPrice: 1,
    },
  };

  return requestJson("POST", `${base}/bloc/v2.2/transaction/parallel?resolve=true`, token, body);
}

function parseHumanAmount(value) {
  const [wholeRaw, fracRaw = ""] = String(value).trim().split(".");
  const whole = wholeRaw || "0";
  const frac = (fracRaw + "0".repeat(18)).slice(0, 18);
  return (BigInt(whole) * WAD + BigInt(frac)).toString();
}

function formatWei(value, decimals = 4) {
  const v = BigInt(value);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const whole = abs / WAD;
  const frac = (abs % WAD).toString().padStart(18, "0").slice(0, decimals);
  const trimmed = frac.replace(/0+$/, "");
  return `${sign}${whole}${trimmed ? "." + trimmed : ""}`;
}

function printJson(label, value) {
  console.log(`\n## ${label}`);
  console.log(JSON.stringify(value, null, 2));
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_VAULT_ADDRESS,
  normalizeAddress,
  readToken,
  requestJson,
  cirrusSearch,
  getUser,
  getVaultRow,
  getTokenBalance,
  sendFunctionTx,
  parseHumanAmount,
  formatWei,
  printJson,
};
