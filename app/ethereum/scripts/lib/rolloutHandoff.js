const fs = require("node:fs");
const path = require("node:path");

const { digest, readJson, writeJson, address, governanceBatch, isDependencyPending, createPortableBundle, loadManifest, generate } = require("./externalBridgeOrchestration");
const { buildTransactionBuilderBatch } = require("./depositRouterSafeOps");
const os = require("node:os");
const { gzipSync, gunzipSync } = require("node:zlib");
const { execFileSync } = require("node:child_process");
const { inspect } = require("./rolloutEabInspection");
const { vote, requireLiveAdminVoteCounts } = require("./rolloutGovernance");
const { withDeadline, loadRolloutEnvironment, INSPECTION_TIMEOUT_MS } = require("./rolloutRuntime");

function portableSnapshot(manifestPath, directory, stage = "activation") {
  const file = path.join(directory, "configuration.snapshot.json");
  const snapshot = structuredClone(createPortableBundle(manifestPath, file, stage));
  delete snapshot.toolingRevision;
  return snapshot;
}

function createApprovalRequest(manifest, report, now = Date.now()) {
  if (manifest.bundlePurpose === "provisioning") throw new Error("Provisioning cannot authorize approvals");
  const batch = governanceBatch(report);
  const calls = batch.calls.map(({ id, call }) => ({ id, call }));
  if (!calls.length) throw new Error("No current governance calls to approve");
  const kind = report.approvalKind || (report.nativeMode ? "native" : "eab");
  const packet = { schemaVersion: 3, phase: batch.phase, issuedAt: now, kind, ...(report.nativeMode ? { nativeMode: report.nativeMode } : {}), expiresAt: now + 2 * 60 * 60 * 1000, manifest, calls };
  const json = JSON.stringify(packet);
  if (Buffer.byteLength(json) > 65_536) throw new Error("Approval file exceeds the supported size; reduce the route set");
  return { packet, request: gzipSync(json).toString("base64url"), approval: digest(packet) };
}

function decodeApprovalRequest(request, approval, now = Date.now()) {
  if (request.length > 90_000 || !/^[A-Za-z0-9_-]+$/.test(request)) throw new Error("Invalid approval request encoding");
  const packet = JSON.parse(gunzipSync(Buffer.from(request, "base64url"), { maxOutputLength: 65_536 }).toString("utf8"));
  if (digest(packet) !== approval) throw new Error("Approval request/hash mismatch");
  if (packet.schemaVersion !== 3 || !["configuration", "activation"].includes(packet.phase)) throw new Error("Approval command is from an earlier rollout version; rerun continue for the current batch");
  if (!Number.isSafeInteger(packet.issuedAt) || !Number.isSafeInteger(packet.expiresAt) || packet.expiresAt <= now ||
      packet.expiresAt - packet.issuedAt !== 2 * 60 * 60 * 1000 || packet.issuedAt > now + 5 * 60 * 1000) throw new Error("Approval handoff expired; request a fresh command from the Coordinator");
  if (!["eab", "native", "all"].includes(packet.kind) || (packet.kind === "native" && !["configure", "activate"].includes(packet.nativeMode))) throw new Error("Unsupported approval kind");
  const m = packet.manifest;
  if (!m || m.toolingRevision || m.bundlePurpose || m.settings?.bridgeTemplate ||
      m.settings?.externalDeployment !== "embedded:externalDeployment" || m.settings?.depositPlan !== "embedded:depositPlan" ||
      !m.inputs?.externalDeployment || !m.inputs?.depositPlan || !Array.isArray(packet.calls) || !packet.calls.length ||
      new Set(packet.calls.map(({ id }) => id)).size !== packet.calls.length) throw new Error("Approval request must contain a complete current configuration and unique calls");
  if (m.scope === "native" && packet.kind !== "native") throw new Error("Native-only scope cannot approve EAB changes");
  return packet;
}

function writeApprovalFile(directory, approvalRequest) {
  const approvalId = approvalRequest.approval.slice(0, 12);
  const file = path.join(directory, `admin-approval-${approvalId}.json`);
  const contents = {
    format: "eab-admin-approval",
    approval: approvalRequest.approval,
    packet: approvalRequest.packet,
  };
  if (fs.existsSync(file) && digest(readJson(file)) !== digest(contents)) {
    throw new Error("Admin approval file changed");
  }
  writeJson(file, contents);
  return { file, approvalId };
}

function readApprovalFile(file, now = Date.now()) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved) || fs.statSync(resolved).size > 100_000) {
    throw new Error("Admin approval file is missing or too large");
  }
  const contents = readJson(resolved);
  if (contents?.format !== "eab-admin-approval" ||
      !/^[a-f0-9]{64}$/.test(contents.approval || "") ||
      digest(contents.packet) !== contents.approval) {
    throw new Error("Invalid or altered admin approval file");
  }
  // Reuse all expiry, schema, scope and embedded-manifest checks.
  const request = gzipSync(JSON.stringify(contents.packet)).toString("base64url");
  return decodeApprovalRequest(request, contents.approval, now);
}

function approvalReview(packet, calls) {
  return {
    approvalId: digest(packet).slice(0, 12),
    phase: packet.phase,
    kind: packet.kind,
    sourceChainId: packet.manifest.settings?.sourceChainId,
    externalChainId: packet.manifest.inputs?.externalDeployment?.chainId,
    expiresAt: new Date(packet.expiresAt).toISOString(),
    calls: calls.map(({ id, call, recordedAdminVotes, requiredAdminVotes }) => ({
      id: id.slice(0, 12),
      target: call.args._target,
      method: call.args._func,
      args: call.args._args,
      recordedAdminVotes,
      requiredAdminVotes,
    })),
  };
}

async function confirmApproval(review, options = {}) {
  if (options.confirmApproval) return options.confirmApproval(review);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error("Admin approval requires an interactive terminal");
  }
  const expected = `APPROVE ${review.approvalId}`;
  console.error(JSON.stringify({ status: "REVIEW_ADMIN_APPROVAL", ...review }, null, 2));
  const readline = require("node:readline/promises");
  const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await terminal.question(`Type ${expected} to submit these calls: `)).trim() === expected;
  } finally {
    terminal.close();
  }
}

function validateApprovalCalls(packet, inspection) {
  const blocker = inspection.report.checks?.find(check => check.status === "FAILED" &&
    ["strato", "external", "external-identity", "safe-runtime-identities"].includes(check.name));
  if (blocker) throw new Error(`Approval blocked by ${blocker.name}: ${blocker.error || blocker.data?.errors?.join("; ") || "verification failed"}. Resolve this check and rerun continue before issuing another approval.`);
  requireLiveAdminVoteCounts(inspection.source, inspection.report);
  const approvedIds = new Set(packet.calls.map(({ id }) => id));
  const batch = governanceBatch(inspection.report);
  const eligible = new Set(batch.calls.map(({ id }) => id));
  return packet.calls.map((approved) => {
    const live = inspection.report.calls.find(({ id }) => id === approved.id);
    if (!live || digest(live.call) !== digest(approved.call) ||
        (live.status !== "COMPLETE" && (!eligible.has(live.id) || batch.phase !== packet.phase))) {
      throw new Error("Approved calls changed or are no longer eligible; request a fresh Coordinator command");
    }
    if (isDependencyPending(live) && live.dependencies.some(id => !approvedIds.has(id))) {
      throw new Error("Approval batch omits an unfinished prerequisite; rerun continue for the complete batch");
    }
    return live;
  }).sort((a, b) => (a.deploymentStage || 0) - (b.deploymentStage || 0));
}

async function runApproval(args, options = {}) {
  const { nativeApprovalInspection } = require("./rolloutNativeInspection");
  const combineInspections = (eab, native) => {
    const calls = [...eab.report.calls, ...native.report.calls];
    return {
      ...eab,
      source: { ...eab.source, calls },
      report: { ...eab.report, calls, approvalKind: "all",
        approvalHash: digest({ phase: governanceBatch({ calls }).phase, calls: calls.map(({ id, status }) => ({ id, status })) }) },
    };
  };
  const packet = args.file
    ? readApprovalFile(args.file)
    : decodeApprovalRequest(args.request, args.approve);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-approval-"));
  const interrupted = () => { fs.rmSync(directory, { recursive: true, force: true });
    console.error("Approval interrupted. Ask the Coordinator to reconcile any submitted votes before retrying."); process.exit(130); };
  const terminated = () => { fs.rmSync(directory, { recursive: true, force: true }); process.exit(143); };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", terminated);
  try {
    const file = path.join(directory, "deployment.json");
    writeJson(file, packet.manifest);
    // Admin credentials are local. Never load a Coordinator profile or deployment.env.
    if (args["env-file"]) loadRolloutEnvironment(file, args["env-file"]);
    const context = loadManifest(file, "activation");
    const artifacts = generate(context, path.join(directory, "generated"), { includeServiceTemplates: false });
    const inspection = await withDeadline("Approval inspection", (signal) => (options.inspect || inspect)(context, artifacts, {
      signal, staged: packet.kind === "eab", onProgress: (message) => console.error(`[approval] ${message}`),
    }), INSPECTION_TIMEOUT_MS);
    const nativeMode = packet.phase === "activation" ? "activate" : "configure";
    const approvalInspection = packet.kind === "native"
      ? await nativeApprovalInspection(context, artifacts, packet.nativeMode, inspection, options)
      : packet.kind === "all"
        ? combineInspections(inspection, await nativeApprovalInspection(context, artifacts, nativeMode, inspection, options))
        : inspection;
    const calls = validateApprovalCalls(packet, approvalInspection);
    if (calls.every(({ status }) => status === "COMPLETE")) return { status: "ALREADY_COMPLETE",
      next: "The approved calls already executed. The Coordinator can continue; no vote was submitted." };
    const review = approvalReview(packet, calls.filter(({ status }) => status !== "COMPLETE"));
    if (args.file && !await confirmApproval(review, options)) {
      return { status: "APPROVAL_CANCELLED", approvalId: review.approvalId,
        next: "No vote was submitted. Ask the Coordinator for a fresh file if the reviewed request changes." };
    }
    console.error(`[approval] Reviewing ${calls.length} bound governance calls on STRATO ${context.settings.sourceChainId}, external chain ${context.rollout.chainId}.`);
    const result = await (options.vote || vote)(context, artifacts, {
      ...approvalInspection, report: { ...approvalInspection.report, calls },
    }, approvalInspection.report.approvalHash, {
      stateless: true, approvalExpiresAt: packet.expiresAt, allowActiveEab: packet.kind === "native" && context.manifest.scope === "native",
      ...(packet.kind === "native" ? { sourceState: async () => (await nativeApprovalInspection(context, artifacts, packet.nativeMode, undefined, options)).source,
        inspect: async () => nativeApprovalInspection(context, artifacts, packet.nativeMode, undefined, options) } : {}),
      ...(packet.kind === "all" ? {
        sourceState: async () => {
          const eabSource = await require("./rolloutEabInspection").sourceState(context, artifacts);
          const native = await nativeApprovalInspection(context, artifacts, nativeMode, approvalInspection, options);
          return { ...eabSource, calls: [...eabSource.calls, ...native.source.calls] };
        },
        inspect: async () => {
          const eab = await inspect(context, artifacts);
          return combineInspections(eab, await nativeApprovalInspection(context, artifacts, nativeMode, eab, options));
        },
      } : {}),
    });
    return { status: result.some(item => item.status === "WAITING_FOR_PREREQUISITES") ? "APPROVAL_PENDING" : "APPROVAL_SUBMITTED", chainId: context.rollout.chainId, results: result,
      next: "Send this result to the Coordinator, who reconciles live execution. No local deployment history is needed. If submission is uncertain, request reconciliation before retrying." };
  } finally {
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", terminated);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function createServiceHandoff(artifacts, options = {}) {
  const files = [...artifacts.serviceTemplates, ...artifacts.verifierPolicyPaths, ...(artifacts.nativeVerifierPolicyPaths || [])];
  const entries = files.map(file => ({ name: path.basename(file), sha256: digest(fs.readFileSync(file, "utf8")) }));
  const application = options.nativeExtension
    ? { kind: "native-extension", runtime: "merge-running", preserve: ["EAB bindings", "policies", "journals", "cursors"] }
    : { kind: "chain-install", runtime: "merge-chain-bindings", initialRunning: false };
  const configurationHash = digest({ entries, application });
  const directory = path.join(path.dirname(artifacts.directory), "service-packages", configurationHash);
  const index = { configurationHash, application, files: entries };
  const indexFile = path.join(directory, "services.json");
  if (!fs.existsSync(indexFile)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    files.forEach(file => fs.copyFileSync(file, path.join(directory, path.basename(file))));
    writeJson(indexFile, index);
  } else if (digest(readJson(indexFile)) !== digest(index)) throw new Error("Managed service package index changed");
  entries.forEach(entry => {
    if (digest(fs.readFileSync(path.join(directory, entry.name), "utf8")) !== entry.sha256) throw new Error("Managed service package file changed");
  });
  const archive = path.join(directory, "service-config.tar.gz");
  if (!fs.existsSync(archive)) {
    const temporary = `${archive}.${process.pid}.tmp`;
    try {
      execFileSync("tar", ["-czf", temporary, "-C", directory, "services.json", ...entries.map(({ name }) => name)]);
      fs.renameSync(temporary, archive);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  } else {
    const expected = ["services.json", ...entries.map(({ name }) => name)].sort();
    const actual = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Managed service archive contents changed");
    for (const name of expected) {
      const bytes = execFileSync("tar", ["-xOf", archive, name]);
      if (!bytes.equals(fs.readFileSync(path.join(directory, name)))) throw new Error("Managed service archive file changed");
    }
  }
  return { file: archive, sha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(archive)).digest("hex"),
    instruction: options.nativeExtension
      ? "Infra verifies this checksum and the native-extension marker. Merge the native keys and policies from the reviewed templates into the running Runtime/verifiers; do not replace the complete existing environments. Preserve EAB bindings, policies, journals, cursors and Running=Yes."
      : "Infra verifies this checksum and the chain-install marker. Merge bridge.env.template into the shared Runtime without deleting existing chain bindings; apply each chain-specific verifier template and policy. Keep new workloads at Running=No and confirm the rendered configuration. Never replace a multi-chain Runtime environment with this chain-only template." };
}

function infraStartRequired(report) {
  const failed = report.checks?.filter(({ status }) => status === "FAILED") || [];
  return report.activationChecksRequired && failed.length > 0 &&
    failed.every(({ name }) => ["verifiers", "bridge-health"].includes(name)) &&
    report.safe?.executionOrder?.every(({ status }) => status === "DONE");
}

function groupSafeAction(context, artifacts, checklist) {
  const pending = checklist.find(({ status }) => status === "PENDING");
  if (!pending) return undefined;
  const pause = pending.step.startsWith("pause-");
  // Do not mix pause, configuration or activation, or include any unverified action.
  if (!pause && checklist.some(({ step, status }) => step.startsWith("pause-") && status !== "DONE")) return pending;
  const items = checklist.filter(({ step, status }) => status === "PENDING" && step.startsWith("pause-") === pause);
  const batches = items.map(({ path: file }) => readJson(file));
  const safe = context.rollout.vaultConfig.chains[0].safeAddress;
  if (batches.some(batch => String(batch.chainId) !== String(context.rollout.chainId) ||
      address(batch.meta?.createdFromSafeAddress) !== address(safe))) throw new Error("Cannot group transactions from different chains or Safes");
  const file = path.join(artifacts.directory, `safe-${digest(batches)}`, pause ? "pause.safe.json" : "configure.safe.json");
  const batch = buildTransactionBuilderBatch(context.rollout.chainId, safe, batches.flatMap(batch => batch.transactions), {
    name: pause ? "Pause bridge intake" : "Configure bridge while paused",
    description: items.map(({ step }) => step).join(", "),
  });
  batch.createdAt = 0;
  writeJson(file, batch);
  return { step: pause ? "pause" : "configure", path: file, status: "PENDING" };
}

module.exports = { portableSnapshot, createApprovalRequest, decodeApprovalRequest, writeApprovalFile, readApprovalFile,
  approvalReview, confirmApproval, validateApprovalCalls, runApproval, createServiceHandoff, infraStartRequired, groupSafeAction };
