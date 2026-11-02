const fs = require("node:fs");

const { shellQuote, governanceBatch } = require("./externalBridgeOrchestration");

function safeCommands(file) {
  if (!fs.existsSync(file)) return undefined;
  const batch = JSON.parse(fs.readFileSync(file, "utf8"));
  const bound = `--file ${shellQuote(file)} --chain-id ${shellQuote(batch.chainId)} --safe ${shellQuote(batch.meta.createdFromSafeAddress)}`;
  return {
    inspect: `npm run safe:batch -- inspect ${bound}`,
    sign: `npm run safe:batch -- sign ${bound} --output "$OWNER_SIGNATURE_FILE"`,
    execute: `npm run safe:batch -- execute ${bound} --signature "$OWNER_SIGNATURE_FILE" --confirm "$REVIEWED_SAFE_TX_HASH"`,
  };
}

function safeActionCommands(file) {
  const commands = safeCommands(file);
  return commands ? { commands } : {};
}

function planReviewSummary(context, artifacts) {
  const { rollout, deployment, manifest } = context;
  const bridgeChain = rollout.bridgeConfig.chains[0];
  const vaultChain = rollout.vaultConfig.chains[0];
  const verifierPolicy = rollout.verifierPolicies[0];
  const withPrefix = (value) => String(value).startsWith("0x") ? String(value) : `0x${value}`;
  const byToken = (items) => new Map(items.map((item) =>
    [withPrefix(item.token).toLowerCase(), item]));
  const vaultTokens = byToken(vaultChain.tokens);
  const verifierTokens = byToken(verifierPolicy.tokens);
  const verifierRoutes = new Map(verifierPolicy.routes.map((route) =>
    [`${withPrefix(route.externalToken).toLowerCase()}:${withPrefix(route.stratoToken).toLowerCase()}`, route]));
  const mintPolicies = byToken(rollout.bridgeConfig.mintPolicies);
  const routes = bridgeChain.routes.map((route) => {
    const externalToken = withPrefix(route.externalToken);
    const stratoToken = withPrefix(route.stratoToken);
    const vaultToken = vaultTokens.get(externalToken.toLowerCase());
    const verifierToken = verifierTokens.get(externalToken.toLowerCase());
    const verifierRoute = verifierRoutes.get(`${externalToken.toLowerCase()}:${stratoToken.toLowerCase()}`);
    const mintPolicy = mintPolicies.get(stratoToken.toLowerCase());
    return {
      symbol: route.externalSymbol,
      externalToken,
      stratoToken,
      permissions: {
        depositsEnabled: route.depositsEnabled,
        withdrawalsEnabled: route.withdrawalsEnabled,
        autoRouteEnabled: route.autoRouteEnabled,
      },
      limitsRaw: {
        maxPerWithdrawal: route.maxPerWithdrawal,
        manualReviewThreshold: route.manualReviewThreshold,
        maxAutoDepositAmount: verifierRoute?.maxAutoDepositAmount,
        maxAutoWithdrawalAmount: verifierToken?.maxAutoWithdrawalAmount,
        bucketCapacity: vaultToken?.bucketCapacity,
        withdrawalRefillRate: vaultToken?.refillRate,
        mintCapacity: mintPolicy?.capacity,
        mintRefillRate: mintPolicy?.refillRate,
      },
      notes: BigInt(route.maxPerWithdrawal) === 0n
        ? ["maxPerWithdrawal=0 means there is no separate per-withdrawal cap; bucket capacity still applies."]
        : [],
    };
  });
  return {
    requiresHumanApproval: [
      "contractBindings",
      "governanceIdentitiesAndThresholds",
      "startingBlock",
      "routePermissions",
      "limitsRaw",
    ],
    scope: {
      mode: context.nativeInputs?.nativeRoutes?.length ? "eab-and-native" : "eab-only",
      network: deployment.network,
      sourceChainId: rollout.bridgeConfig.sourceChainId,
      externalChainId: rollout.chainId,
      startingBlock: bridgeChain.lastProcessedBlock,
      routeCount: routes.length,
    },
    contractBindings: {
      tokenRouter: manifest.settings.tokenRouter,
      externalAssetBridge: manifest.settings.externalAssetBridge,
      safe: vaultChain.safeAddress,
      vault: vaultChain.vaultAddress,
      depositRouter: vaultChain.depositRouterAddress,
    },
    governanceIdentitiesAndThresholds: {
      bridgeOperator: manifest.settings.bridgeOperator,
      guardian: manifest.settings.guardian,
      settlementAttestors: manifest.settings.settlementVerifiers,
      settlementThreshold: rollout.bridgeConfig.externalAssetBridge.settlementVerifierThreshold,
      authorizationSigners: vaultChain.attestationSigners,
      authorizationThreshold: vaultChain.attestationThreshold,
      authorizationValiditySeconds: vaultChain.maxAuthorizationValiditySeconds,
      safeProposer: manifest.services.safeProposerAddress,
      externalExecutor: manifest.services.executorAddress,
    },
    confirmations: {
      runtime: manifest.services.confirmations,
      verifiers: manifest.services.verifiers.map(({ url, confirmations }) => ({
        url,
        confirmations: confirmations ?? manifest.services.confirmations,
      })),
    },
    routes,
    ...(context.nativeInputs?.nativeRoutes?.length ? { native: context.nativeInputs } : {}),
    mechanicalChecks: {
      schemaAndCrossFileConsistency: "PASSED",
      unresolvedReviewValues: JSON.stringify(manifest).includes("REVIEW_REQUIRED")
        ? "FAILED" : "PASSED",
      artifactHashIndex: "WRITTEN",
      verifierPolicyHashes: rollout.verifierPolicies.map((_, index) =>
        artifacts.hashes[`verifier-${index + 1}.json`]),
      infraPolicyComparison: "Compare these hashes with the reviewed files deployed by Infra.",
    },
    serviceTemplateNote: "bridge.env.template contains only this rollout. When adding a chain to an existing multi-network Runtime, merge these chain bindings instead of replacing the existing template.",
  };
}

function rolloutProgress(report, args, artifacts, context, environmentFile) {
  const common = [`--manifest ${shellQuote(args.manifest)}`];
  if (args["env-file"]) common.push(`--env-file ${shellQuote(args["env-file"])}`);
  const resumeCommand = `npm run external:rollout -- generate ${common.join(" ")}`;
  const safeChecklist = report.safe?.executionOrder;
  const sourceToken = context?.manifest.services.sourceTokenEnv;
  const rpcUrl = context?.manifest.services.rpcUrlEnv;
  const oauthReady = process.env[sourceToken] || (process.env.GLOBAL_ADMIN_NAME &&
    process.env.GLOBAL_ADMIN_PASSWORD && process.env.OAUTH_URL && process.env.OAUTH_CLIENT_ID &&
    process.env.OAUTH_CLIENT_SECRET);
  const oauthRequirement = `${sourceToken} or GLOBAL_ADMIN_NAME + GLOBAL_ADMIN_PASSWORD + OAUTH_URL + OAUTH_CLIENT_ID + OAUTH_CLIENT_SECRET`;
  const environment = context && {
    secretsFile: environmentFile,
    secretsFileLoaded: fs.existsSync(environmentFile),
    availableNow: [
      process.env[rpcUrl] && rpcUrl,
      oauthReady && oauthRequirement,
    ].filter(Boolean),
    missingNow: [
      !process.env[rpcUrl] && rpcUrl,
      !oauthReady && oauthRequirement,
    ].filter(Boolean),
    runtimeServiceVariables: "Not rollout inputs; fill the generated bridge/verifier env templates only when deploying services.",
  };
  const safeAction = safeChecklist?.find(({ status }) => status === "PENDING");
  const failedChecks = report.checks?.filter(({ status }) => status === "FAILED").map(({ name }) => name) || [];
  const batch = governanceBatch(report);
  const ready = batch.calls;
  if (ready.length) {
    if (["UNAVAILABLE", "DEFERRED"].includes(report.liveVoteCounts?.status)) {
      return {
        currentStage: batch.phase === "activation" ? "Activation" : "Configuration",
        readyCallCount: ready.length,
        voteState: report.liveVoteCounts.status === "DEFERRED" ? "VOTES_DEFERRED" : "LIVE_ADMIN_VOTES_UNAVAILABLE",
        action: report.liveVoteCounts.status === "DEFERRED" ? "Complete the paused external configuration before issuing admin approvals." : "Live AdminRegistry vote counts are unavailable. Do not infer zero votes. Restore the STRATO vote query and rerun generate.",
        safeAction,
      failedChecks,
      safeChecklist,
        environment,
        resumeCommand,
      };
    }
    const voteCounts = ready.map(item => item.recordedAdminVotes || 0);
    const requirementsKnown = ready.every(({ requiredAdminVotes }) =>
      Number.isSafeInteger(requiredAdminVotes) && requiredAdminVotes > 0);
    const voteRequirements = ready.map((item, index) => ({
      id: item.id,
      required: item.requiredAdminVotes,
      recorded: voteCounts[index],
      remaining: requirementsKnown ? Math.max(0, item.requiredAdminVotes - voteCounts[index]) : undefined,
    }));
    const maximumRemainingVotes = requirementsKnown
      ? Math.max(...voteRequirements.map(({ remaining }) => remaining)) : undefined;
    const minimumRecordedVotes = Math.min(...voteCounts);
    const readyMethods = Object.entries(ready.reduce((counts, { call }) => {
      counts[call.args._func] = (counts[call.args._func] || 0) + 1;
      return counts;
    }, {})).map(([method, count]) => ({ method, count }));
    const voteState = !requirementsKnown ? "GOVERNANCE_THRESHOLD_UNAVAILABLE"
      : maximumRemainingVotes === 0 ? "WAITING_FOR_EXECUTION"
      : maximumRemainingVotes === 1 && minimumRecordedVotes === 1 &&
        voteRequirements.every(({ required }) => required === 2)
        ? "WAITING_ON_SECOND_ADMIN"
        : minimumRecordedVotes === 0 ? "FIRST_ADMIN_VOTE_REQUIRED" : "ADMIN_VOTES_REQUIRED";
    return {
      currentStage: batch.phase === "activation" ? "Activation" : "Configuration",
      readyCallCount: ready.length,
      readyMethods,
      voteRequirements,
      voteState,
      action: voteState === "WAITING_FOR_EXECUTION"
        ? "The live AdminRegistry threshold is met. Wait for execution/indexing, then rerun generate."
        : voteState === "WAITING_ON_SECOND_ADMIN"
          ? "The first administrator vote is recorded. This batch is waiting on the second administrator."
          : voteState === "GOVERNANCE_THRESHOLD_UNAVAILABLE"
            ? "The live AdminRegistry threshold is unavailable. Do not infer quorum from local vote files; restore the STRATO governance query and rerun generate."
          : voteState === "FIRST_ADMIN_VOTE_REQUIRED"
            ? "No successful administrator vote is recorded for every remaining call. An administrator runs the configuration batch now."
            : `${maximumRemainingVotes} additional administrator vote(s) are required for at least one remaining call.`,
      approvalRequired: !["WAITING_FOR_EXECUTION", "GOVERNANCE_THRESHOLD_UNAVAILABLE"].includes(voteState),
      afterQuorum: "Wait for execution, then rerun generate. Never reuse an older approval hash.",
      safeAction,
      failedChecks,
      safeChecklist,
      environment,
      resumeCommand,
    };
  }
  return { action: report.next, failedChecks, safeAction, safeChecklist, environment, resumeCommand };
}

function resolveNextAction(report, args = {}, artifacts, context, environmentFile) {
  const operator = report.operator || rolloutProgress(report, args, artifacts, context, environmentFile);
  const action = (() => {
    if (report.status === "OFFLINE_PLAN_INCOMPLETE") {
      return {
        status: "OFFLINE_PLAN_INCOMPLETE",
        action: "RESOLVE_REVIEW_REQUIRED",
        then: report.next,
        review: report.review,
      };
    }
    if (report.status === "OFFLINE_PLAN_READY") {
      return {
        status: "OFFLINE_PLAN_READY",
        action: "REVIEW_POLICY_SUMMARY",
        then: report.next,
        review: report.review,
      };
    }
    if (report.nativeScopeComplete) return { status: "NATIVE_ACTIVE_CANARY_REQUIRED", role: "coordinator",
      action: "RUN_NATIVE_CANARIES", instruction: "Native is active. EAB was not changed. Reconcile native canaries before exposing native intake." };
    if (report.nativeAction) return {
      status: "ACTION_REQUIRED",
      ...report.nativeAction,
      ...(report.nativeAction.file && report.nativeAction.action?.includes("SAFE")
        ? safeActionCommands(report.nativeAction.file) : {}),
    };
    if (report.infraAction) return { status: "ACTION_REQUIRED", role: "infra", phase: "start",
      action: "START_OR_REPAIR_SERVICES", instruction: "Confirm the processor/Safe-writer handoff, apply the reviewed service archive and start workloads. Repair any reported readiness mismatch; then the Coordinator reruns generate.",
      infra: report.infraAction, failedChecks: operator.failedChecks };
    if (report.managed) {
      return { status: report.status, role: "coordinator", action: "REVIEW_CONFIGURATION",
        instruction: report.status === "PROVISIONING_PACKAGE_READY"
          ? report.nativeExtension
            ? "Send Infra this archive to provision missing native identities on the existing stack. Preserve EAB configuration and service state; enter returned public values in the manifest, then rerun prepare."
            : "Send Infra this archive to provision missing identities with Running=No. Enter returned public values in the manifest, then rerun prepare."
          : report.nativeExtension
          ? "Review native configuration in details. Send Infra this archive to add native support to existing workloads; keep EAB running. No admin setup or EAB redeployment."
          : "Review the configuration summary in details. Send Infra the service archive; keep new workloads stopped. No admin setup is required.",
        infra: report.serviceHandoff, resume: report.resume };
    }
    if (report.adminApproval) {
      return { status: "ACTION_REQUIRED", role: "admins", phase: report.activationChecksRequired ? "activate" : "configure",
        action: "APPROVE_CURRENT_CONFIGURATION", ...report.adminApproval };
    }
    if (report.previousStageCompleted || operator.stageExecuted) {
      operator.stageExecuted = true;
      return {
        status: "STAGE_EXECUTED",
        action: "RERUN_GENERATE",
        run: operator.resumeCommand,
        then: "Review the next stage and use only its newly reported approval hash.",
      };
    }
    if (report.operationError?.startsWith("Approval is stale") || operator.approvalInvalidated) {
      operator.approvalInvalidated = true;
      return {
        status: "APPROVAL_INVALIDATED",
        action: "RERUN_GENERATE",
        run: operator.resumeCommand,
        then: "Review live state before submitting any further transaction.",
      };
    }
    if (report.operationError) return { status: "WAITING", action: "RESOLVE_OPERATION_ERROR",
      instruction: "Resolve the error and rerun generate; reconcile any uncertain submission first.", run: operator.resumeCommand };
    if (report.activationFile) {
      return {
        status: "ACTION_REQUIRED",
        action: "EXECUTE_ACTIVATION_TRANSACTION_IN_SAFE",
        file: report.activationFile,
        ...safeActionCommands(report.activationFile),
        then: "Run generate after Safe execution, then complete the canary.",
      };
    }
    if (operator.safeAction) {
      return {
        status: "ACTION_REQUIRED",
        action: "EXECUTE_SAFE_TRANSACTION",
        step: operator.safeAction.step,
        file: operator.safeAction.path,
        ...safeActionCommands(operator.safeAction.path),
        then: "Run generate again after the Safe transaction executes.",
      };
    }
    const requirements = operator.voteRequirements || [];
    const progress = requirements.length === 1
      ? `${requirements[0].recorded}/${requirements[0].required} admin votes recorded`
      : undefined;
    if (operator.voteState === "VOTES_DEFERRED" || operator.voteState === "LIVE_ADMIN_VOTES_UNAVAILABLE" ||
        operator.voteState === "GOVERNANCE_THRESHOLD_UNAVAILABLE") {
      return {
        status: "WAITING",
        step: operator.currentStage,
        action: operator.voteState,
        then: operator.action,
        run: operator.resumeCommand,
      };
    }
    if (operator.approvalRequired) return { status: "WAITING", step: operator.currentStage,
      action: "RESTORE_APPROVAL_READINESS", progress, instruction: operator.action,
      run: operator.resumeCommand, failedChecks: operator.failedChecks };
    if (operator.voteState === "WAITING_FOR_EXECUTION") {
      return {
        status: "WAITING",
        step: operator.currentStage,
        action: "Wait for governance execution/indexing.",
        run: operator.resumeCommand,
      };
    }
    return {
      status: report.status,
      action: operator.action || report.next,
      run: operator.nextSteps?.[0]?.run || operator.resumeCommand,
      instruction: operator.nextSteps?.[0]?.action,
      failedChecks: operator.failedChecks?.length ? operator.failedChecks : undefined,
    };
  })();
  return { progress: operator, nextAction: action };
}

function terminalSummary(report, reportFile) {
  return { ...report.nextAction, details: reportFile };
}

function preparationStage(manifest) {
  const services = manifest.services;
  const missing = value => !value || value === "REVIEW_REQUIRED";
  const native = manifest.inputs?.nativeConfig;
  return !manifest.authorizationSigners?.length || !services.verifiers?.length ||
    missing(services.safeProposerAddress) || missing(services.executorAddress) ||
    (manifest.inputs?.nativeRoutes?.length && (missing(native?.executor) || missing(native?.eabExecutor) ||
      !native?.attestationSigners?.length || native.attestationSigners.some(missing))) ? "initial" : "activation";
}

function provisioningReviewComplete(manifest) {
  const reviewed = structuredClone(manifest);
  reviewed.authorizationSigners = [];
  for (const field of ["safeProposerAddress", "executorAddress"]) delete reviewed.services[field];
  for (const verifier of reviewed.services.verifiers) delete verifier.url;
  const native = reviewed.inputs?.nativeConfig;
  if (native) for (const field of ["attestationSigners", "executor", "eabExecutor"]) delete native[field];
  return !JSON.stringify(reviewed).includes("REVIEW_REQUIRED");
}

module.exports = { safeCommands, planReviewSummary, rolloutProgress, resolveNextAction, terminalSummary, preparationStage, provisioningReviewComplete };
