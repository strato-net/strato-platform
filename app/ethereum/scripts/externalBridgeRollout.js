const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const dotenv = require("dotenv");
dotenv.config({ quiet: true });
dotenv.config({ path: path.resolve(__dirname, "../../contracts/.env"), quiet: true, override: false });
const { digest, readJson, writeJson, initializeManifest, loadManifest, generate, loadConfig, shellQuote, governanceBatch } = require("./lib/externalBridgeOrchestration");
const { buildPlan } = require("../../contracts/deploy/configure-external-bridge");
const { limitConcurrentFetches, withDeadline, acquireRolloutLock, parseArgs, loadRolloutEnvironment, redact, jsonFetch, fetchRolloutOAuthToken, resolveSourceToken, stratoApiUrl, normalizeStratoRequestUrl, TIMEOUT_MS, INSPECTION_TIMEOUT_MS } = require("./lib/rolloutRuntime");
const { fetchAdminVotingPolicy, requiredAdminVotes, recordedVoteMetadata, recordedIssueIds, comparableGovernanceValue, parseGovernanceEventArgs, sameGovernanceArgs, fetchLiveAdminVoteCounts, requireLiveAdminVoteCounts, vote, recordedVoteCounts, approvedCallsCompleted } = require("./lib/rolloutGovernance");
const { validateSafeRuntimeIdentities, sourceState, checkImplementations, checkImplementationsAtBlock, expectedSourceDifferences, inspect, activate } = require("./lib/rolloutEabInspection");
const { nativeGovernanceCalls, nativeGovernanceProgress, nativeOnlyEabVerified, validateNativeReadiness, nativeApprovalInspection, nativeHandoff, nativeConfigurationFingerprint, nativeCoordinatorAction, recordNativeCompletion, advanceNative, verifyNativeActivation } = require("./lib/rolloutNativeInspection");
const { portableSnapshot, createApprovalRequest, decodeApprovalRequest, writeApprovalFile, readApprovalFile,
  approvalReview, validateApprovalCalls, runApproval, createServiceHandoff, infraStartRequired, groupSafeAction } = require("./lib/rolloutHandoff");
const { planReviewSummary, rolloutProgress, resolveNextAction, terminalSummary, preparationStage, provisioningReviewComplete } = require("./lib/rolloutOutput");

async function expandDeploymentDraft(manifestPath) {
  const draft = readJson(manifestPath);
  if (draft.schemaVersion !== 0 || !draft.discovery) return false;
      const internal = path.join(path.dirname(manifestPath), ".deployment");
      const input = structuredClone(draft.discovery);
      const base = draft.discoveryDirectory || path.dirname(manifestPath);
      for (const field of ["externalDeployment", "nativeDeployment"]) {
        if (input.target?.[field]) input.target[field] = path.resolve(base, input.target[field]);
      }
      const external = path.join(internal, "external", "external-deployment.json");
      if (!input.target?.externalDeployment && fs.existsSync(external)) input.target.externalDeployment = external;
      for (const route of input.nativeRoutes || []) if (route.deployment) route.deployment = path.resolve(base, route.deployment);
      const key = digest(input);
      const config = path.join(internal, `prepare-${key}.json`);
      const prepared = path.join(internal, `prepared-${key}`);
      writeJson(config, input);
      const completion = path.join(prepared, ".complete");
      if (!fs.existsSync(completion)) {
        if (fs.existsSync(prepared)) fs.renameSync(prepared, `${prepared}.incomplete-${randomUUID()}`);
        const token = await resolveSourceToken({ manifest: { services: { sourceTokenEnv: "ACCESS_TOKEN" } } });
        await withDeadline("Deployment input preparation", () => require("./prepareBridgeRollout").main(["--config", config, "--output-dir", prepared], { token, quiet: true }), INSPECTION_TIMEOUT_MS);
        fs.writeFileSync(completion, key, { mode: 0o600 });
      }
      const expanded = path.join(internal, `expanded-${key}.json`);
      if (!fs.existsSync(expanded)) initializeManifest(path.join(prepared, "settings.json"), path.join(prepared, "policy.json"), expanded);
      writeJson(manifestPath, readJson(expanded));
  return true;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs([...argv]);
  if (args.command === "approve") {
    console.log(JSON.stringify(await runApproval(args), null, 2));
    return;
  }
  const manifestPath = path.resolve(args.manifest);
  if (args.command === "init") {
    if (args["node-url"]) {
      if (fs.existsSync(manifestPath)) throw new Error("Deployment file already exists; discovery did not overwrite it");
      loadRolloutEnvironment(manifestPath, args["env-file"]);
      const token = await resolveSourceToken({ manifest: { services: { sourceTokenEnv: "ACCESS_TOKEN" } } });
      const result = await withDeadline("Route discovery", (signal) => require("./prepareBridgeRollout").discover(
        args["node-url"], args["chain-id"], token,
        (url, options) => fetch(url, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) }),
        { sourceChainId: args["source-chain-id"] }), INSPECTION_TIMEOUT_MS);
      const directory = path.join(path.dirname(manifestPath), ".deployment", `discovery-${randomUUID()}`);
      writeJson(path.join(directory, "discovery.json"), { candidates: result.candidates, missing: result.missing });
      writeJson(manifestPath, { schemaVersion: 0, discovery: result.config, discoveryDirectory: directory });
      console.log(JSON.stringify({ status: "DRAFT_CREATED", manifest: manifestPath,
        action: "Select the approved EAB/native routes and target addresses in this file. Run prepare; no bridge:prepare or second init command is needed.",
        next: `npm run external:rollout -- prepare --manifest ${shellQuote(manifestPath)}` }, null, 2));
      return;
    }
    if (args.discovery) {
      if (fs.existsSync(manifestPath)) throw new Error("Deployment file already exists; it was not overwritten");
      const discoveryPath = path.resolve(args.discovery);
      writeJson(manifestPath, { schemaVersion: 0, discovery: readJson(discoveryPath), discoveryDirectory: path.dirname(discoveryPath) });
      console.log(JSON.stringify({ status: "DRAFT_CREATED", manifest: manifestPath,
        action: "Edit discovery.target and route include flags in this deployment file, then run prepare; expansion is automatic." }, null, 2));
      return;
    }
    const settingsPath = args.settings ? path.resolve(args.settings) : manifestPath;
    if (!fs.existsSync(settingsPath) && !args.settings) {
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.resolve(__dirname, "../externalBridgeRollout.settings.example.json"),
        manifestPath, fs.constants.COPYFILE_EXCL);
      console.log(JSON.stringify({
        status: "DRAFT_CREATED",
        manifest: manifestPath,
        action: "Fill the deployment inputs and rerun this exact init command.",
      }, null, 2));
      return;
    }
    if (!fs.existsSync(settingsPath)) throw new Error(`Settings file not found: ${settingsPath}`);
    const draft = readJson(settingsPath);
    if (draft.schemaVersion === 0 && draft.discovery) {
      loadRolloutEnvironment(manifestPath, args["env-file"]);
      await expandDeploymentDraft(manifestPath);
      console.log(JSON.stringify({ status: "MANIFEST_CREATED", manifest: manifestPath,
        action: "Review the same deployment file, then run prepare. Expansion also runs automatically inside prepare." }, null, 2));
      return;
    }
    initializeManifest(settingsPath, args.policy && path.resolve(args.policy), manifestPath);
    console.log(`Created ${manifestPath}. Review policy, confirmation counts, and service bindings there.`);
    return;
  }
  const environmentFile = loadRolloutEnvironment(manifestPath, args["env-file"]);
  const output = path.resolve(args["output-dir"] || path.join(
    path.dirname(manifestPath),
    ".deployment",
  ));
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const lock = path.join(output, ".lock");
  const releaseLock = acquireRolloutLock(lock);
  try {
    if (args.command === "prepare" && await expandDeploymentDraft(manifestPath)) {
      console.log(JSON.stringify({ status: "MANIFEST_CREATED", manifest: manifestPath,
        action: "Review settings, policy and native inputs in this same file, then rerun the same prepare command.",
        next: `npm run external:rollout -- prepare --manifest ${shellQuote(manifestPath)}${args.stage === "initial" ? " --stage initial" : ""}` }, null, 2));
      return;
    }
    if (args.command === "prepare" && !argv.includes("--stage")) args.stage = preparationStage(readJson(manifestPath));
    const context = loadManifest(manifestPath, args.stage);
    if (context.manifest.scope && !["all", "native"].includes(context.manifest.scope)) throw new Error("scope must be all or native");
    if (context.manifest.scope === "native" && !context.nativeInputs.nativeRoutes?.length) throw new Error("Native scope requires native routes and configuration");
    const artifacts = generate(context, output);
    let report;
    let currentInspection;
    if (["plan", "prepare"].includes(args.command)) {
      const settings = loadConfig(artifacts.bridgeConfigPath);
      const review = planReviewSummary(context, artifacts);
      const planComplete = review.mechanicalChecks.unresolvedReviewValues === "PASSED";
      report = { revision: context.revision,
        status: planComplete ? "OFFLINE_PLAN_READY" : "OFFLINE_PLAN_INCOMPLETE",
        artifacts,
        governance: ["initialize", "routes", "actions"].flatMap((step) => buildPlan(settings, step)),
        review,
        next: planComplete
          ? "Review the saved bindings, identities, starting block, permissions and raw limits; run prepare to create the Infra service archive, then continue for current approvals."
          : "Resolve every REVIEW_REQUIRED value in the manifest and rerun prepare before live reconciliation." };
      if (args.command === "prepare") {
        if (!planComplete && (context.stage === "activation" || !provisioningReviewComplete(context.manifest))) process.exitCode = 1;
        else {
          portableSnapshot(manifestPath, artifacts.directory, context.stage);
          report.status = context.stage === "initial" ? "PROVISIONING_PACKAGE_READY" : "PREPARED_FOR_REVIEW";
          report.managed = true;
          report.serviceHandoff = createServiceHandoff(artifacts, { nativeExtension: context.manifest.scope === "native" });
          if (context.manifest.scope === "native") report.serviceHandoff.instruction = "Provision/apply native additions on existing Runtime/verifiers while retaining Running=Yes, EAB bindings, policies and journals. Return any new native identities; no EAB redeployment.";
          report.nativeExtension = context.manifest.scope === "native";
          report.resume = context.stage === "initial"
            ? `npm run external:rollout -- prepare --manifest ${shellQuote(manifestPath)}`
            : `npm run external:rollout -- continue --manifest ${shellQuote(manifestPath)}`;
          report.next = "Review the saved configuration summary. Give Infra the service archive; keep workloads stopped. Continue as Coordinator to generate the current admin commands and Safe JSON.";
          delete report.nextSteps;
        }
      }
    } else {
      console.error("Checking live rollout state (60s per check; 180s overall). No transactions are submitted during inspection.");
      const inspection = await withDeadline("Live rollout inspection", (signal) => inspect(context, artifacts, {
        signal, staged: args.command === "continue", onProgress: (message) => console.error(`[rollout] ${message}`),
      }), INSPECTION_TIMEOUT_MS);
      currentInspection = inspection;
      report = inspection.report;
      if (context.manifest.scope === "native" && !nativeOnlyEabVerified(context, inspection)) throw new Error("Native extension requires unchanged, healthy, active EAB configuration. Resolve EAB drift/readiness before continuing; no EAB changes were submitted.");

    }
    report.operator = resolveNextAction(report, args, artifacts, context, environmentFile).progress;
    if (["continue", "verify"].includes(args.command)) {
      if (report.operator.safeAction) report.operator.safeAction = groupSafeAction(context, artifacts, report.safe.executionOrder);
      report.nativeAction = nativeCoordinatorAction(context, report, output, manifestPath);
      const externalReadsVerified = ["external-identity", "safe-runtime-identities"].every(name => report.checks?.find(check => check.name === name)?.status === "PASSED");
      const safeConfigured = report.safe?.executionOrder?.every(({ status }) => status === "DONE");
      if (!externalReadsVerified) {
        report.nativeAction = undefined;
        report.operator = { action: "Restore external code/Safe identity verification before approving configuration.",
          failedChecks: report.checks.filter(({ status }) => status === "FAILED").map(({ name }) => name),
          resumeCommand: report.operator.resumeCommand };
      } else if (report.operator.approvalRequired && !safeConfigured && !report.operator.safeAction) {
        report.operator = { action: "Restore Safe configuration reads before approving governance.",
          failedChecks: report.checks.filter(({ status }) => status === "FAILED").map(({ name }) => name),
          resumeCommand: report.operator.resumeCommand };
      }
      if (report.nativeAction && externalReadsVerified && safeConfigured) report.nativeAction = await advanceNative(context, artifacts, report, output, manifestPath, currentInspection);
      if (report.nativeAction?.status === "NATIVE_APPROVAL_READY") {
        const nativeInspection = report.nativeAction.inspection;
        const calls = [...report.calls, ...nativeInspection.report.calls];
        if (new Set(calls.map(({ id }) => id)).size !== calls.length) throw new Error("Combined EAB/native approval contains duplicate governance calls");
        report.calls = calls;
        report.approvalKind = "all";
        report.approvalHash = digest({ phase: governanceBatch(report).phase, calls: calls.map(({ id, status }) => ({ id, status })) });
        report.nativeAction = undefined;
      }
      if (context.manifest.scope === "native" && !report.nativeAction) {
        await verifyNativeActivation(context, artifacts, currentInspection);
        report.nativeScopeComplete = true;
      }
      if (!report.nativeAction && !report.approvalKind && !report.operator.safeAction && externalReadsVerified && report.status === "READY_FOR_ACTIVATION_REVIEW" && context.manifest.scope !== "native") {
        await verifyNativeActivation(context, artifacts, currentInspection);
        report.activationFile = activate(context, artifacts, currentInspection, report.approvalHash);
      }
      if (!report.nativeAction && !report.operator.safeAction && externalReadsVerified && infraStartRequired(report)) {
        report.infraAction = createServiceHandoff(artifacts, { nativeExtension: context.manifest.scope === "native" });
      }
      if (report.operator.approvalRequired && report.liveVoteCounts?.status === "LIVE" && safeConfigured && !report.operator.safeAction && !report.nativeAction && !report.infraAction) {
        const snapshot = portableSnapshot(manifestPath, artifacts.directory);
        const request = createApprovalRequest(snapshot, report);
        const handoff = writeApprovalFile(artifacts.directory, request);
        report.adminApproval = { phase: request.packet.phase === "activation" ? "activate" : "configure", summary: request.packet.calls.map(({ call }) => ({ target: call.args._target, method: call.args._func, args: call.args._args })),
          expiresAt: new Date(request.packet.expiresAt).toISOString(),
          file: handoff.file, approvalId: handoff.approvalId,
          run: `npm run external:rollout -- approve --file ${shellQuote(path.basename(handoff.file))}`,
          instruction: "Send this file to each required admin under its existing basename. From app/ethereum, each admin runs the short command with their own credentials, reviews the decoded calls and confirms the displayed approval ID. The Coordinator reconciles live execution afterward." };
      }
    }
    report.nextAction = resolveNextAction(report, args, artifacts, context, environmentFile).nextAction;
    const reportFile = path.join(artifacts.directory, `report-${Date.now()}-${randomUUID()}.json`);
    writeJson(reportFile, report);
    writeJson(path.join(output, "latest.json"), { revision: context.revision, reportFile });
    console.log(JSON.stringify(terminalSummary(report, reportFile), null, 2));
    if (args.command === "verify" && report.status !== "READY_FOR_ACTIVATION_REVIEW" && report.status !== "DEPOSITS_ACTIVE_CANARY_REQUIRED") process.exitCode = 1;
  } finally { releaseLock(); }
}

if (require.main === module) main().then(() => {
  // Timed-out read-only requests may still hold third-party sockets; never leave the CLI hanging.
  process.exit(process.exitCode || 0);
}).catch((error) => { console.error(redact(error.message)); process.exit(1); });
module.exports = { expectedSourceDifferences, limitConcurrentFetches, expandDeploymentDraft, advanceNative, validateNativeReadiness, nativeOnlyEabVerified, infraStartRequired, fetchRolloutOAuthToken, nativeCoordinatorAction, nativeConfigurationFingerprint, nativeGovernanceCalls, nativeGovernanceProgress, nativeApprovalInspection, nativeHandoff, portableSnapshot, createApprovalRequest, decodeApprovalRequest, writeApprovalFile, readApprovalFile, approvalReview, validateApprovalCalls, runApproval, createServiceHandoff, groupSafeAction, withDeadline, acquireRolloutLock, parseArgs, loadRolloutEnvironment, redact, validateSafeRuntimeIdentities, resolveSourceToken, stratoApiUrl, normalizeStratoRequestUrl, fetchAdminVotingPolicy, requiredAdminVotes, recordedIssueIds, fetchLiveAdminVoteCounts, sourceState, checkImplementations, inspect, vote, activate, recordedVoteCounts, approvedCallsCompleted, resolveNextAction, terminalSummary, preparationStage, main };
