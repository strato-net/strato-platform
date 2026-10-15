const fs = require("node:fs");
const path = require("node:path");

const { randomUUID } = require("node:crypto");
const dotenv = require("dotenv");
const TIMEOUT_MS = 30_000;
const CHECK_TIMEOUT_MS = 60_000;
const INSPECTION_TIMEOUT_MS = 180_000;
// Increment when rollout rules change the meaning of persisted native progress.
const ROLLOUT_SCHEMA_VERSION = 2;

function limitConcurrentFetches(fetchImpl, limit = 3) {
  const slots = Array.from({ length: limit }, () => Promise.resolve());
  let next = 0;
  return (url, options = {}) => {
    const slot = next++ % limit;
    const request = slots[slot].then(() => {
      options.signal?.throwIfAborted();
      return fetchImpl(url, options);
    });
    // A failed request releases its slot; queued aborted reads never reach the server.
    slots[slot] = request.then(() => {}, () => {});
    return request;
  };
}

async function withDeadline(label, work, timeoutMs, parentSignal) {
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  let timer;
  let onAbort;
  try {
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        const error = new Error(`${label} timed out after ${timeoutMs / 1000}s; restore connectivity and rerun continue`);
        error.code = "ROLLOUT_TIMEOUT";
        controller.abort(error);
      }, timeoutMs);
    });
    signal.throwIfAborted();
    return await Promise.race([Promise.resolve().then(() => work(signal)), interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function acquireRolloutLock(file, processImpl = process) {
  const handle = fs.openSync(file, "wx", 0o600);
  const ownership = JSON.stringify({ pid: processImpl.pid, startedAt: new Date().toISOString(), nonce: randomUUID() });
  fs.writeFileSync(handle, ownership);
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    processImpl.removeListener("SIGINT", interrupted);
    processImpl.removeListener("SIGTERM", terminated);
    fs.closeSync(handle);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === ownership) fs.unlinkSync(file);
  };
  const interrupted = () => { cleanup(); processImpl.exit(130); };
  const terminated = () => { cleanup(); processImpl.exit(143); };
  processImpl.once("SIGINT", interrupted);
  processImpl.once("SIGTERM", terminated);
  return cleanup;
}

function parseArgs(argv) {
  const command = argv[0]?.startsWith("--") ? "plan" : argv.shift() || "plan";
  if (!["init", "prepare", "continue", "approve", "plan", "verify"].includes(command)) {
    throw new Error("Use init|prepare|continue|approve|plan|verify; resume existing deployments with continue --manifest <deployment-file>");
  }
  const args = { command };
  const allowed = command === "approve" ? ["file", "request", "approve", "env-file"]
    : command === "init" ? ["manifest", "settings", "policy", "discovery", "node-url", "chain-id", "source-chain-id", "env-file"]
    : ["manifest", "output-dir", "stage", "env-file"];
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index].replace(/^--/, "");
    if (!argv[index].startsWith("--") || !allowed.includes(name) || !argv[index + 1] || argv[index + 1].startsWith("--") || args[name]) throw new Error(`Invalid or duplicate option ${argv[index]}`);
    args[name] = argv[index + 1];
  }
  if (command === "approve") {
    const fileApproval = !!args.file;
    const legacyApproval = !!args.request || !!args.approve;
    if (fileApproval === legacyApproval) throw new Error("approve requires one current --file from the Coordinator");
    if (legacyApproval && (!args.request || !/^[a-f0-9]{64}$/.test(args.approve || ""))) {
      throw new Error("Legacy approval requires both --request and --approve");
    }
    return args;
  }
  if (!args.manifest) throw new Error("--manifest is required; local role profiles are no longer used");
  if (["prepare", "continue", "verify"].includes(command)) args.stage ||= "activation";
  if (args.stage && !["initial", "activation"].includes(args.stage)) throw new Error("--stage must be initial|activation");
  if (command === "init" && args["node-url"] && (!args["chain-id"] || !args["source-chain-id"] || args.discovery || args.settings || args.policy)) throw new Error("Discovery init requires --node-url, --chain-id and --source-chain-id without --settings/--policy/--discovery");
  if (command === "init" && !args["node-url"] && (args["chain-id"] || args["source-chain-id"])) throw new Error("--node-url is required for discovery init");
  if (args.discovery && (args.settings || args.policy)) throw new Error("Use --discovery or --settings/--policy, not both");
  return args;
}

function loadRolloutEnvironment(manifest, configuredFile) {
  const file = configuredFile
    ? path.resolve(configuredFile) : path.join(path.dirname(path.resolve(manifest)), "deployment.env");
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, quiet: true, override: true });
    const config = require("../../../contracts/deploy/config");
    config.nodes[0].oauth.openIdDiscoveryUrl = process.env.OAUTH_URL;
    config.nodes[0].oauth.clientId = process.env.OAUTH_CLIENT_ID;
    config.nodes[0].oauth.clientSecret = process.env.OAUTH_CLIENT_SECRET;
  }
  return file;
}

function redact(message, env = process.env, secretNames = []) {
  let result = String(message);
  for (const [name, value] of Object.entries(env)) {
    if (value?.length >= 8 && (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|RPC.*URL|API_KEY/.test(name) || secretNames.includes(name))) result = result.split(value).join("[REDACTED]");
  }
  return result.replace(/https?:\/\/[^\s"<>]+/g, (url) => {
    try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}/[REDACTED]`; } catch { return "[REDACTED URL]"; }
  });
}

const redactFor = (context, message) => redact(message, process.env, [
  context.manifest.services.sourceTokenEnv, context.manifest.services.rpcUrlEnv,
  ...context.manifest.services.verifiers.map(({ tokenEnv }) => tokenEnv),
]);

async function jsonFetch(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchRolloutOAuthToken(username, password, fetchImpl = fetch) {
  const oauth = require("../../../contracts/deploy/config").nodes[0].oauth;
  const discoveryUrl = process.env.OAUTH_URL || oauth.openIdDiscoveryUrl;
  if (!discoveryUrl?.startsWith("https://")) throw new Error("Configure HTTPS STRATO OAuth discovery");
  const discovery = await jsonFetch(discoveryUrl, undefined, fetchImpl);
  if (!discovery.token_endpoint?.startsWith("https://")) throw new Error("OAuth discovery lacks an HTTPS token endpoint");
  const body = new URLSearchParams({ grant_type: "password", username, password,
    client_id: process.env.OAUTH_CLIENT_ID || oauth.clientId,
    client_secret: process.env.OAUTH_CLIENT_SECRET || oauth.clientSecret });
  if (process.env.OAUTH_SCOPE) body.set("scope", process.env.OAUTH_SCOPE);
  if (process.env.OAUTH_TOTP) body.set("totp", process.env.OAUTH_TOTP.trim());
  const response = await fetchImpl(discovery.token_endpoint, { method: "POST", body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`STRATO authentication failed (HTTP ${response.status})`);
  return (await response.json())[oauth.tokenField || "access_token"];
}

async function resolveSourceToken(context, authImpl) {
  const tokenEnv = context.manifest.services.sourceTokenEnv;
  if (process.env[tokenEnv]) return process.env[tokenEnv];
  const { GLOBAL_ADMIN_NAME: username, GLOBAL_ADMIN_PASSWORD: password } = process.env;
  if (!username || !password) throw new Error(`Set ${tokenEnv} or configure STRATO credentials in app/contracts/.env`);
  const auth = authImpl || { getUserToken: fetchRolloutOAuthToken };
  const token = await withDeadline("STRATO authentication", () => auth.getUserToken(username, password), TIMEOUT_MS);
  if (!token) throw new Error("STRATO OAuth did not return an access token");
  process.env[tokenEnv] = token;
  return token;
}

function stratoApiUrl(nodeUrl) {
  const url = new URL(nodeUrl);
  const pathName = url.pathname.replace(/\/+$/, "");
  url.pathname = pathName.endsWith("/strato-api") ? pathName : `${pathName}/strato-api`;
  return url.href.replace(/\/$/, "");
}

function normalizeStratoRequestUrl(nodeUrl, requestUrl) {
  const baseUrl = nodeUrl.replace(/\/$/, "");
  if (requestUrl.startsWith(`${baseUrl}/eth/`)) {
    return `${stratoApiUrl(baseUrl)}${requestUrl.slice(baseUrl.length)}`;
  }
  return requestUrl;
}

module.exports = { limitConcurrentFetches, withDeadline, acquireRolloutLock, parseArgs, loadRolloutEnvironment, redact, jsonFetch, fetchRolloutOAuthToken, resolveSourceToken, stratoApiUrl, normalizeStratoRequestUrl, redactFor, TIMEOUT_MS, CHECK_TIMEOUT_MS, INSPECTION_TIMEOUT_MS, ROLLOUT_SCHEMA_VERSION };
