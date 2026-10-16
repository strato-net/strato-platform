const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  parseArgs, loadRolloutEnvironment, fetchRolloutOAuthToken,
} = require("../scripts/lib/rolloutRuntime");
const {
  scopeOf, mergeDiscovery, initializeDraft, preflightDraft, preflight,
  activationReady, generateCurrent,
} = require("../scripts/lib/bridgeDeploymentFlow");

const address = digit => `0x${digit.repeat(40)}`;

function batch(safe, to = address("2")) {
  return {
    version: "1.0",
    chainId: "11155111",
    createdAt: 0,
    meta: { createdFromSafeAddress: safe },
    transactions: [{ to, value: "0", data: "0x", operation: 0 }],
  };
}

function fixture(t, scope = "eab-only") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-flow-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifestPath = path.join(directory, "deployment.json");
  fs.writeFileSync(manifestPath, "{}");
  const safe = address("1");
  const context = {
    revision: "reviewed-manifest",
    manifest: {
      scope,
      services: {
        nodeUrl: "https://strato.example",
        rpcUrlEnv: "TARGET_RPC_URL",
        bridgeHealthUrl: "https://runtime.example/health",
        confirmations: 12,
        safeProposerAddress: address("6"),
        executorAddress: address("7"),
        verifiers: [1, 2, 3].map(index => ({
          url: `https://verifier-${index}.example`,
          tokenEnv: `VERIFIER_${index}_TOKEN`,
          confirmations: 12,
        })),
      },
      authorizationSigners: [address("8"), address("9"), address("a")],
    },
    settings: { sourceChainId: "114784819836269" },
    nativeInputs: scope === "eab-only" ? {} : {
      nativeRoutes: [{}],
      nativeConfig: { safeAddress: safe },
    },
    rollout: {
      chainId: 11155111,
      vaultConfig: { chains: [{ safeAddress: safe }] },
    },
  };
  const eabFile = path.join(directory, "eab.safe.json");
  fs.writeFileSync(eabFile, JSON.stringify(batch(safe)));
  const generated = (_context, output) => {
    const artifactDirectory = path.join(output, "revision");
    fs.mkdirSync(artifactDirectory, { recursive: true });
    const service = path.join(artifactDirectory, "bridge.env.template");
    const policy = path.join(artifactDirectory, "verifier-1.json");
    fs.writeFileSync(service, "NODE_URL=https://strato.example\n");
    fs.writeFileSync(policy, "{}\n");
    return {
      directory: artifactDirectory,
      serviceTemplates: [service],
      verifierPolicyPaths: [policy],
      nativeVerifierPolicyPaths: [],
    };
  };
  const inspection = async () => ({
    report: {
      checks: [],
      calls: [],
      approvalHash: "live-state",
      safe: { executionOrder: [{ step: "pause-router", path: eabFile, status: "PENDING" }] },
    },
  });
  return { directory, manifestPath, safe, context, generated, inspection };
}

test("operator CLI is init, preflight, generate, verify, activate", () => {
  for (const command of ["init", "preflight", "generate", "verify", "activate"]) {
    assert.equal(parseArgs([command, "--manifest", "deployment.json"]).command, command);
  }
  assert.equal(parseArgs(["init", "--manifest", "deployment.json",
    "--chain-id", "11155111", "--source-chain-id", "1"])["chain-id"], "11155111");
  for (const command of ["prepare", "continue", "plan", "resume"]) {
    assert.throws(() => parseArgs([command, "--manifest", "deployment.json"]), /Use init\|preflight\|generate\|verify\|activate/);
  }
});

test("rollout environment reuses the selected RPC from app/ethereum env names", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-env-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = path.join(directory, "deployment.json");
  const envFile = path.join(directory, "deployment.env");
  fs.writeFileSync(manifest, "{}");
  fs.writeFileSync(envFile, "DEPLOY_ENV=testnet\nNETWORK=linea\n");
  const names = ["DEPLOY_ENV", "NETWORK", "LINEA_SEPOLIA_RPC_URL", "CHAIN_59141_RPC_URL"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => names.forEach(name => saved[name] === undefined
    ? delete process.env[name] : process.env[name] = saved[name]));
  process.env.LINEA_SEPOLIA_RPC_URL = "https://linea.example";
  delete process.env.CHAIN_59141_RPC_URL;
  loadRolloutEnvironment(manifest, envFile);
  assert.equal(process.env.CHAIN_59141_RPC_URL, "https://linea.example");
});

test("rollout authentication sends the configured production OTP", async t => {
  const names = ["OAUTH_URL", "OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "OAUTH_TOTP"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => names.forEach(name => saved[name] === undefined
    ? delete process.env[name] : process.env[name] = saved[name]));
  Object.assign(process.env, {
    OAUTH_URL: "https://auth.example/.well-known/openid-configuration",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    OAUTH_TOTP: "123456",
  });
  let tokenRequest;
  const token = await fetchRolloutOAuthToken("admin", "password", async (url, options = {}) => {
    if (!options.method) return { ok: true, json: async () => ({ token_endpoint: "https://auth.example/token" }) };
    tokenRequest = options;
    return { ok: true, json: async () => ({ access_token: "token" }) };
  });
  assert.equal(token, "token");
  assert.equal(tokenRequest.body.get("totp"), "123456");
});

test("live init refresh preserves reviewed route decisions in one file", () => {
  const old = { schemaVersion: 0, discovery: {
    target: { chainId: 1, externalAssetBridge: address("9") },
    eabRoutes: [{ sourceChainId: "5", stratoToken: address("1"), include: true, max: "7" }],
    nativeRoutes: [],
  } };
  const refreshed = {
    target: { chainId: 1, externalAssetBridge: "REVIEW_REQUIRED" },
    eabRoutes: [{ sourceChainId: "5", stratoToken: address("1"), include: false, externalName: "Token" }],
    nativeRoutes: [],
  };
  const merged = mergeDiscovery(old, refreshed);
  assert.equal(merged.discovery.target.externalAssetBridge, address("9"));
  assert.equal(merged.discovery.eabRoutes[0].include, true);
  assert.equal(merged.discovery.eabRoutes[0].externalName, "Token");
});

test("initial discovery creates one complete public configuration draft", () => {
  const draft = initializeDraft({
    source: { stratoChainId: "114784819836269" },
    target: { chainId: 11155111 },
    eabRoutes: [],
    nativeRoutes: [],
  }, "https://strato.example");
  assert.equal(draft.scope, "combined");
  assert.equal(draft.services.nodeUrl, "https://strato.example");
  assert.equal(draft.services.verifiers.length, 3);
  assert.equal(draft.authorizationSigners.length, 3);
  assert.equal(draft.discovery.target.safeAddress, "REVIEW_REQUIRED");
  assert.equal(draft.discovery.target.roles.guardianAddress, "REVIEW_REQUIRED");
});

test("preflight validates the reviewed draft before deployment artifacts exist", async () => {
  const safe = address("1");
  const draft = initializeDraft({
    source: { stratoChainId: "114784819836269" },
    target: { chainId: 11155111 },
    eabRoutes: [{ include: true }],
    nativeRoutes: [],
  }, "https://strato.example");
  draft.scope = "eab-only";
  draft.discovery.target.safeAddress = safe;
  draft.discovery.target.permit2Address = address("2");
  draft.discovery.target.bridgeOperator = address("3");
  draft.discovery.target.guardian = address("4");
  draft.discovery.target.settlementVerifiers = [address("5"), address("6"), address("7")];
  draft.discovery.target.deploymentConfirmations = 12;
  Object.keys(draft.discovery.target.roles).forEach((name, index) => {
    draft.discovery.target.roles[name] = address(String(index + 3));
  });
  draft.authorizationSigners = [address("a"), address("b"), address("c")];
  Object.assign(draft.services, {
    confirmations: 12,
    bridgeHealthUrl: "https://runtime.example/health",
    safeProposerAddress: address("d"),
    executorAddress: address("e"),
  });
  draft.services.verifiers.forEach((verifier, index) => Object.assign(verifier, {
    url: `https://verifier-${index + 1}.example`,
    confirmations: 12,
  }));
  process.env.CHAIN_11155111_RPC_URL = "https://rpc.example";
  try {
    const result = await preflightDraft(draft, {
      provider: {
        getNetwork: async () => ({ chainId: 11155111n }),
        getCode: async () => "0x01",
        getBlock: async () => ({ number: 100, hash: `0x${"f".repeat(64)}` }),
      },
      readSafe: async () => ({ owners: [safe], threshold: 1n }),
      resolveToken: async () => "token",
      fetchJson: async () => ({ networkID: "114784819836269" }),
    });
    assert.equal(result.status, "PREFLIGHT_PASSED");
  } finally {
    delete process.env.CHAIN_11155111_RPC_URL;
  }
});

test("preflight gates review values and verifies STRATO, RPC, and Safe", async t => {
  const f = fixture(t);
  const previous = process.env.TARGET_RPC_URL;
  process.env.TARGET_RPC_URL = "https://rpc.example";
  t.after(() => previous === undefined ? delete process.env.TARGET_RPC_URL
    : process.env.TARGET_RPC_URL = previous);
  const provider = {
    getNetwork: async () => ({ chainId: 11155111n }),
    getCode: async () => "0x01",
    getBlock: async () => ({ number: 100, hash: `0x${"f".repeat(64)}` }),
  };
  const result = await preflight(f.context, {
    provider,
    readSafe: async () => ({ owners: [f.safe], threshold: 1n }),
    resolveToken: async () => "token",
    fetchJson: async () => ({ networkID: "114784819836269" }),
  });
  assert.equal(result.status, "PREFLIGHT_PASSED");
  f.context.manifest.limit = "REVIEW_REQUIRED";
  await assert.rejects(preflight(f.context, { provider }), /Resolve every REVIEW_REQUIRED/);
});

test("generate writes only canonical atomic preactivation outputs and recovers by replacement", async t => {
  const f = fixture(t, "combined");
  const nativePlan = async () => ({ transactions: [{}], safe: batch(f.safe, address("3")) });
  const first = await generateCurrent(f.context, f.manifestPath, "preactivation", {
    generate: f.generated, inspect: f.inspection, nativePlan, provider: {},
    nativeInspection: async () => ({ report: { calls: [] } }),
  });
  assert.deepEqual(first.files, [
    `preactivation-safe-${f.safe}.json`,
    "service-config.tar.gz",
    "services.json",
  ]);
  const safe = JSON.parse(fs.readFileSync(path.join(first.directory, first.files[0])));
  assert.equal(safe.transactions.length, 2);
  assert.match(safe.meta.reviewBinding, /^[a-f0-9]{64}$/);
  const archiveDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-services-test-"));
  t.after(() => fs.rmSync(archiveDirectory, { recursive: true, force: true }));
  execFileSync("tar", ["-xzf", path.join(first.directory, "service-config.tar.gz"), "-C", archiveDirectory]);
  const services = JSON.parse(fs.readFileSync(path.join(archiveDirectory, "services.json")));
  assert.deepEqual(services.files.map(({ name }) => name).sort(), ["bridge.env.template", "verifier-1.json"]);
  services.files.forEach(({ name, sha256 }) => {
    const actual = createHash("sha256").update(fs.readFileSync(path.join(archiveDirectory, name), "utf8")).digest("hex");
    assert.equal(sha256, actual);
  });
  fs.writeFileSync(path.join(first.directory, "stale.json"), "{}");
  const second = await generateCurrent(f.context, f.manifestPath, "preactivation", {
    generate: f.generated, inspect: f.inspection, nativePlan, provider: {},
    nativeInspection: async () => ({ report: { calls: [] } }),
  });
  assert.equal(fs.existsSync(path.join(second.directory, "stale.json")), false);
});

test("generate rejects EAB and native destination on different Safes", async t => {
  const f = fixture(t, "combined");
  await assert.rejects(generateCurrent(f.context, f.manifestPath, "preactivation", {
    generate: f.generated,
    inspect: f.inspection,
    provider: {},
    nativePlan: async () => ({ transactions: [{}], safe: batch(address("4")) }),
    nativeInspection: async () => ({ report: { calls: [] } }),
  }), /use multiple Safes/);
  assert.equal(fs.existsSync(path.join(f.directory, ".deployment", "current")), false);
});

test("generate refuses partial Safe handoffs when any prerequisite is unverified", async t => {
  const f = fixture(t);
  await assert.rejects(generateCurrent(f.context, f.manifestPath, "preactivation", {
    generate: f.generated,
    inspect: async () => ({
      report: {
        checks: [],
        calls: [],
        approvalHash: "live-state",
        safe: { executionOrder: [
          { step: "pause-router", path: path.join(f.directory, "eab.safe.json"), status: "PENDING" },
          { step: "configure-vault", status: "UNVERIFIED" },
        ] },
      },
    }),
  }), /could not be fully verified/);
  assert.equal(fs.existsSync(path.join(f.directory, ".deployment", "current")), false);
});

test("activation is separate and remains blocked by live readiness gates", async t => {
  const f = fixture(t);
  const checks = [
    "external-identity", "deposit-router", "withdrawal-pause",
    "safe-runtime-identities", "vault-configuration", "verifiers", "bridge-health",
  ].map(name => ({ name, status: "PASSED" }));
  const inspection = {
    router: { paused: true },
    report: {
      checks,
      calls: [],
      approvalHash: "live-ready",
      safe: { executionOrder: [{ status: "DONE" }] },
    },
  };
  assert.equal(activationReady(f.context, inspection), true);
  checks.at(-1).status = "FAILED";
  assert.equal(activationReady(f.context, inspection), false);
  checks.at(-1).status = "PASSED";
  const activate = (_context, artifacts) => {
    const file = path.join(artifacts.directory, "activate.safe.json");
    fs.writeFileSync(file, JSON.stringify(batch(f.safe)));
    return file;
  };
  const result = await generateCurrent(f.context, f.manifestPath, "activation", {
    generate: f.generated,
    inspect: async () => inspection,
    activate,
  });
  assert.deepEqual(result.files, [`activation-safe-${f.safe}.json`]);
});

test("scope validation covers combined, EAB-only, and native extension", () => {
  assert.equal(scopeOf({ manifest: { scope: "eab-only" }, nativeInputs: {} }), "eab-only");
  assert.equal(scopeOf({ manifest: { scope: "combined" }, nativeInputs: { nativeRoutes: [{}] } }), "combined");
  assert.equal(scopeOf({ manifest: { scope: "native-extension" }, nativeInputs: { nativeRoutes: [{}] } }), "native-extension");
  assert.throws(() => scopeOf({ manifest: { scope: "combined" }, nativeInputs: {} }), /requires native routes/);
});

test("native extension generates native-only preactivation from an initialized EAB manifest", async t => {
  const f = fixture(t, "native-extension");
  const result = await generateCurrent(f.context, f.manifestPath, "preactivation", {
    generate: f.generated,
    inspect: async () => ({ report: { checks: [], calls: [], approvalHash: "live-state",
      safe: { executionOrder: [] } } }),
    nativePlan: async () => ({ transactions: [{}], safe: batch(f.safe, address("3")) }),
    provider: {},
    nativeInspection: async () => ({ report: { calls: [] } }),
  });
  assert.deepEqual(result.files, [
    `preactivation-safe-${f.safe}.json`,
    "service-config.tar.gz",
    "services.json",
  ]);
  const safe = JSON.parse(fs.readFileSync(path.join(result.directory, result.files[0])));
  assert.equal(safe.transactions.length, 1);
  const services = JSON.parse(fs.readFileSync(path.join(result.directory, "services.json")));
  assert.deepEqual(services.application, { kind: "native-extension", runtime: "merge-running" });
});
