import { config } from "../config";
import { GitHubClient, IssueComment, IssueSummary } from "../github/client";
import { extractImageUrls, fetchImages } from "../github/images";
import { ImageInput } from "../llm/types";
import { triageClient } from "../llm/registry";
import { issueLog, log } from "../log";
import { IssueState, IssueStatus, ScreeningRecord, StateStore } from "../state/store";
import { generatePlan, runCiFix, runImplementation, ImplementOutcome } from "../agent/runner";
import { SCREENING_SCHEMA, SCREENING_SYSTEM, screeningUser } from "../agent/prompts";
import { truncate } from "../agent/tools";
import { evaluateBuild, failureContext, findBuildForSha, branchJobExists, isJenkinsConfigured, triggerBranchBuild, triggerBranchScan } from "../ci/jenkins";
import { deployToTrackingServer, isDeployConfigured } from "../deploy/ssh";
import * as git from "../workspace/git";
import { failureDetails } from "../workspace/checks";
import {
  CRITERIA,
  clarifyComment,
  declineCriterionComment,
  declineDecisionComment,
  doneComment,
  needsHumanComment,
  planComment,
  renderPlan,
  replyComment,
  statusComment,
} from "./comments";

// The per-issue state machine. fastStep() runs every poll for every issue the
// bot is assigned to (cheap GitHub reads, Jenkins polling, deploys);
// slowStep() runs for one issue at a time and owns the workspace
// (screening → planning → implementing → push, and CI fix rounds).

export interface IssueContext {
  gh: GitHubClient;
  store: StateStore;
  botLogin: string;
}

type Screening = ScreeningRecord;

const WAKEABLE: IssueStatus[] = ["declined", "clarifying", "done", "needs_human"];
export const SLOW_STATES: IssueStatus[] = ["screening", "planning", "implementing"];

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

const branchFor = (issue: IssueSummary): string => `${config.github.branchPrefix}issue-${issue.number}-${slugify(issue.title) || "change"}`;

const humanComments = (comments: IssueComment[], botLogin: string): IssueComment[] =>
  comments.filter((c) => c.user.login !== botLogin && c.user.type !== "Bot");

const newestHumanCommentId = (comments: IssueComment[], botLogin: string): number =>
  humanComments(comments, botLogin).reduce((max, c) => Math.max(max, c.id), 0);

const setStatus = async (ctx: IssueContext, issue: IssueSummary, state: IssueState, status: IssueStatus, event: string, patch: Partial<IssueState> = {}): Promise<IssueState> => {
  const next = ctx.store.upsertIssue(issue.number, { errors: 0, ...patch, status, title: issue.title }, event);
  const label = `${config.github.labelPrefix}:${status.replace(/_/g, "-")}`;
  await ctx.gh.setBotLabel(issue.number, issue.labels, label).catch((e) => log.warn("Issue", `#${issue.number} label update failed: ${e}`));
  log.info("Issue", `#${issue.number} → ${status} (${event})`);
  return next;
};

const updateStatus = async (ctx: IssueContext, state: IssueState, fields: Parameters<typeof statusComment>[0]): Promise<void> => {
  if (!state.statusCommentId || state.statusCommentId <= 0) return;
  await ctx.gh.updateComment(state.statusCommentId, statusComment(fields)).catch((e) => log.warn("Issue", `status comment update failed: ${e}`));
};

// Re-open a parked issue when a human has said something new
const wakeIfCommented = async (ctx: IssueContext, issue: IssueSummary, state: IssueState, comments: IssueComment[]): Promise<IssueState> => {
  if (!WAKEABLE.includes(state.status)) return state;
  const newest = newestHumanCommentId(comments, ctx.botLogin);
  if (newest > (state.lastSeenCommentId ?? 0)) {
    return setStatus(ctx, issue, state, "screening", `woken by comment ${newest}`, { lastError: undefined, wokenFrom: state.status });
  }
  return state;
};

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------
const screen = async (issue: IssueSummary, comments: IssueComment[], botLogin: string, images: ImageInput[]): Promise<Screening> =>
  triageClient().structured<Screening>({
    system: SCREENING_SYSTEM,
    user: screeningUser(issue, comments, botLogin, images.length),
    images,
    name: "record_screening",
    description: "Record the scope verdict and the implement/clarify/decline decision",
    schema: SCREENING_SCHEMA,
    validate: (v: any) => ({
      inScope: Boolean(v?.inScope),
      scopeReason: String(v?.scopeReason ?? ""),
      decision: (["implement", "clarify", "decline", "reply", "none"].includes(v?.decision) ? v.decision : "clarify") as Screening["decision"],
      decisionReason: String(v?.decisionReason ?? ""),
      reply: String(v?.reply ?? ""),
      assumptions: Array.isArray(v?.assumptions) ? v.assumptions.map(String) : [],
      questions: Array.isArray(v?.questions) ? v.questions.map(String) : [],
      isFollowUp: Boolean(v?.isFollowUp),
    }),
  });

const coreTeamCheck = async (ctx: IssueContext, login: string): Promise<{ member: boolean; detail: string } | null> => {
  const viaApi = await ctx.gh.isCoreTeamMember(login);
  if (viaApi !== null) {
    return { member: viaApi, detail: `GitHub team @${config.github.owner}/${config.github.coreTeamSlug} membership: ${viaApi ? "active" : "not a member"}` };
  }
  if (config.github.coreTeamMembers.length) {
    const member = config.github.coreTeamMembers.includes(login.toLowerCase());
    return { member, detail: `configured core team allowlist: ${member ? "listed" : "not listed"}` };
  }
  return null; // cannot determine — retry later
};

// Runs screening → planning → implementing → push in one go (same workspace lock)
export const slowStep = async (ctx: IssueContext, issueNumber: number): Promise<void> => {
  const issue = await ctx.gh.getIssue(issueNumber);
  const comments = await ctx.gh.listComments(issueNumber);
  let state = ctx.store.getIssue(issueNumber) ?? ctx.store.upsertIssue(issueNumber, { status: "screening", title: issue.title }, "first seen");
  if (issue.state !== "open" || !issue.assignees.includes(ctx.botLogin)) return;
  // Mockups/screenshots referenced anywhere in the conversation
  const images: ImageInput[] = (await fetchImages(extractImageUrls([issue.body, ...comments.map((c) => c.body)]), config.github.token || undefined)).map((i) => ({ mediaType: i.mediaType, base64: i.base64 }));
  if (images.length) log.info("Issue", `#${issue.number}: ${images.length} image attachment(s) loaded`);

  // ---- screening --------------------------------------------------------
  if (state.status === "screening") {
    const seen = newestHumanCommentId(comments, ctx.botLogin);
    const core = await coreTeamCheck(ctx, issue.user.login);
    if (!core) {
      log.error("Issue", `#${issue.number}: cannot verify core-team membership of @${issue.user.login} (token lacks read:org and CORE_TEAM_MEMBERS is empty); retrying next poll`);
      return;
    }
    if (!core.member) {
      // The creator cannot change, so say it once; later comments re-park silently
      if (state.declinedFor !== "core-team") {
        await ctx.gh.createComment(
          issue.number,
          declineCriterionComment(CRITERIA.coreTeam, `@${issue.user.login} opened this issue, and I could not confirm they belong to the core team (${core.detail}). I only take work filed by core team members.`)
        );
      }
      await setStatus(ctx, issue, state, "declined", "criterion 2 unmet", { lastSeenCommentId: seen, declinedFor: "core-team", wokenFrom: undefined });
      return;
    }

    const screening = await screen(issue, comments, ctx.botLogin, images);
    issueLog(issue.number, "screening", JSON.stringify(screening, null, 2));
    if (!screening.inScope) {
      await ctx.gh.createComment(issue.number, declineCriterionComment(CRITERIA.scope, screening.scopeReason || "The request needs changes outside the tracking server."));
      await setStatus(ctx, issue, state, "declined", "criterion 3 unmet", { lastSeenCommentId: seen, declinedFor: "scope", wokenFrom: undefined });
      return;
    }
    if (screening.decision === "decline") {
      await ctx.gh.createComment(issue.number, declineDecisionComment(screening.decisionReason));
      await setStatus(ctx, issue, state, "declined", "decided not to implement", { lastSeenCommentId: seen, declinedFor: "decision", wokenFrom: undefined });
      return;
    }
    if (screening.decision === "reply" || screening.decision === "none") {
      if (screening.decision === "reply" && screening.reply.trim()) {
        await ctx.gh.createComment(issue.number, `${replyComment(screening.reply)}`);
      }
      const back = state.wokenFrom && state.wokenFrom !== "screening" ? state.wokenFrom : "declined";
      await setStatus(ctx, issue, state, back, `${screening.decision === "reply" ? "replied" : "no action needed"}; back to ${back}`, { lastSeenCommentId: seen, wokenFrom: undefined });
      return;
    }
    if (screening.decision === "clarify") {
      await ctx.gh.createComment(issue.number, clarifyComment(screening.questions.length ? screening.questions : ["Could you describe the expected behaviour in more detail?"], screening.decisionReason));
      await setStatus(ctx, issue, state, "clarifying", "asked for clarification", { lastSeenCommentId: seen, wokenFrom: undefined });
      return;
    }
    state = await setStatus(ctx, issue, state, "planning", "screening passed", {
      lastSeenCommentId: seen,
      branch: state.branch ?? branchFor(issue),
      screening,
      wokenFrom: undefined,
      declinedFor: undefined,
    });
  }

  const branch = state.branch ?? branchFor(issue);
  const screening: Screening = state.screening ?? {
    inScope: true,
    scopeReason: "",
    decision: "implement",
    decisionReason: "",
    reply: "",
    assumptions: [],
    questions: [],
    isFollowUp: false,
  };

  // ---- planning ---------------------------------------------------------
  if (state.status === "planning") {
    const { resumed } = await git.prepareBranch(branch);
    let priorContext = "";
    if (resumed) {
      priorContext = `The branch ${branch} already exists with the bot's earlier work:\n${await git.recentLog(8)}\n\nDiff stat vs ${config.github.baseBranch}:\n${await git.diffStat()}`;
    }
    const plan = await generatePlan(issue, comments, ctx.botLogin, screening, priorContext, images);
    const planText = renderPlan(plan);
    const commentId = await ctx.gh.createComment(issue.number, planComment(plan, branch, screening.isFollowUp || resumed));
    state = await setStatus(ctx, issue, state, "implementing", "plan posted", { plan: planText, planCommentId: commentId, branch });
  }

  // ---- implementing -----------------------------------------------------
  if (state.status === "implementing") {
    const plan = state.plan ?? "(plan unavailable — implement the issue as described)";
    const { resumed } = await git.prepareBranch(branch);
    const extra = resumed
      ? `NOTE: the branch already contains earlier commits by the bot (see git log); build on top of them.\n${await git.recentLog(8)}`
      : "";
    const outcome = await runImplementation(issue, comments, ctx.botLogin, plan, extra, images);
    await finishImplementationRound(ctx, issue, state, branch, outcome, "implementation");
  }
};

// Shared tail of implementation and CI-fix rounds: commit, push, PR, status
const finishImplementationRound = async (
  ctx: IssueContext,
  issue: IssueSummary,
  state: IssueState,
  branch: string,
  outcome: ImplementOutcome,
  kind: "implementation" | "ci-fix"
): Promise<void> => {
  if (outcome.blocked || !outcome.ok) {
    const reason = outcome.blocked
      ? `The implementation agent stopped: ${outcome.finish.summary}`
      : `The change did not pass the bot's checks after ${outcome.rounds} attempt(s).`;
    const details = [
      outcome.policy.problems.join("\n"),
      outcome.validation ? `${outcome.validation.summary}\n\n${failureDetails(outcome.validation)}` : "",
      outcome.finish.notes,
    ]
      .filter(Boolean)
      .join("\n\n");
    // Keep the branch with whatever was produced so a human can pick it up
    if (outcome.changedFiles.length && !config.dryRun) {
      try {
        if (config.workspace.regenerateBuildMetadata) await git.regenerateBuildMetadata();
        const sha = await git.commitAll(`WIP: ${issue.title} (#${issue.number}) — needs human review`);
        if (sha) await git.push(branch);
      } catch (error) {
        log.warn("Issue", `#${issue.number}: could not push WIP branch: ${error}`);
      }
    }
    await ctx.gh.createComment(issue.number, needsHumanComment(reason, truncate(details || "(no details)", 20_000), branch));
    // lastSeenCommentId is deliberately left at its screening-time value so
    // anything humans said meanwhile wakes the issue again
    await setStatus(ctx, issue, state, "needs_human", `${kind} failed`, { lastError: reason });
    return;
  }

  if (config.workspace.regenerateBuildMetadata) await git.regenerateBuildMetadata();
  const message = kind === "ci-fix" ? `Fix Jenkins failure for #${issue.number}` : `${issue.title} (#${issue.number})`;
  const commitMessage = `${message}\n\n${outcome.finish.summary}`.slice(0, 4000);
  const sha = (await git.commitAll(commitMessage)) ?? (await git.headSha());
  await git.push(branch);
  log.info("Issue", `#${issue.number}: pushed ${branch}@${sha.slice(0, 10)}`);

  let prUrl: string | undefined;
  let prNumber = state.prNumber;
  if (config.github.openPullRequest) {
    const existing = await ctx.gh.findOpenPullRequest(branch);
    if (existing) {
      prUrl = existing.htmlUrl;
      prNumber = existing.number;
    } else {
      const pr = await ctx.gh.createPullRequest(
        branch,
        config.github.baseBranch,
        `${issue.title} (#${issue.number})`,
        `Implements #${issue.number}.\n\n${outcome.finish.summary}\n\n${outcome.finish.testsAdded.map((t) => `- ${t}`).join("\n")}`
      );
      prUrl = pr.htmlUrl || undefined;
      prNumber = pr.number > 0 ? pr.number : undefined;
    }
  }

  const phase = isJenkinsConfigured() ? "pushed, waiting for Jenkins" : "pushed";
  const statusId = await ctx.gh.createComment(
    issue.number,
    statusComment({ branch, sha, prUrl, phase, lines: [`${kind === "ci-fix" ? "CI fix round" : "Implementation"} pushed at ${new Date().toISOString()}`] })
  );
  await setStatus(ctx, issue, state, "ci", `${kind} pushed`, {
    headSha: sha,
    prNumber,
    ciStartedAt: new Date().toISOString(),
    buildUrl: undefined,
    buildNumber: undefined,
    ciFailureContext: undefined,
    lastError: undefined,
    finish: outcome.finish,
    statusCommentId: statusId,
    prUrl,
  });
};

// ---------------------------------------------------------------------------
// Fast steps: wake-ups, Jenkins polling, deploy
// ---------------------------------------------------------------------------
export const fastStep = async (ctx: IssueContext, issue: IssueSummary): Promise<void> => {
  let state = ctx.store.getIssue(issue.number) ?? ctx.store.upsertIssue(issue.number, { status: "screening", title: issue.title }, "first seen");
  if (issue.state !== "open") {
    if (state.status !== "closed") await setStatus(ctx, issue, state, "closed", "issue closed");
    return;
  }
  if (state.status === "closed") {
    state = await setStatus(ctx, issue, state, "screening", "issue reopened");
  }
  if (WAKEABLE.includes(state.status)) {
    if (state.lastSeenUpdatedAt === issue.updatedAt) return; // nothing new on the issue
    const comments = await ctx.gh.listComments(issue.number);
    state = await wakeIfCommented(ctx, issue, state, comments);
    if (WAKEABLE.includes(state.status)) ctx.store.upsertIssue(issue.number, { lastSeenUpdatedAt: issue.updatedAt });
    return;
  }

  if (state.status === "ci") await pollCi(ctx, issue, state);
  else if (state.status === "deploying") await deploy(ctx, issue, state);
};

const pollCi = async (ctx: IssueContext, issue: IssueSummary, state: IssueState): Promise<void> => {
  const branch = state.branch!;
  const sha = state.headSha!;
  if (!isJenkinsConfigured()) {
    log.warn("Issue", `#${issue.number}: Jenkins not configured; skipping CI gate`);
    await setStatus(ctx, issue, state, "deploying", "CI skipped (Jenkins not configured)");
    return deploy(ctx, issue, ctx.store.getIssue(issue.number)!);
  }
  const elapsedMin = (Date.now() - new Date(state.ciStartedAt ?? Date.now()).getTime()) / 60_000;
  const build = await findBuildForSha(branch, sha);
  const verdict = evaluateBuild(build);

  if (verdict === "not_found") {
    if (elapsedMin > config.jenkins.timeoutMinutes) {
      await ctx.gh.createComment(issue.number, needsHumanComment(`No Jenkins build appeared for \`${branch}\` @ ${sha.slice(0, 10)} within ${config.jenkins.timeoutMinutes} minutes.`, "Check that the multibranch job indexes this branch.", branch));
      await setStatus(ctx, issue, state, "needs_human", "no Jenkins build", { lastError: "no Jenkins build" });
      return;
    }
    if (!(await branchJobExists(branch))) {
      if (!state.scanTriggeredAt || Date.now() - new Date(state.scanTriggeredAt).getTime() > 5 * 60_000) {
        await triggerBranchScan();
        ctx.store.upsertIssue(issue.number, { scanTriggeredAt: new Date().toISOString() });
      }
    } else if (elapsedMin > config.jenkins.triggerAfterMinutes && !state.buildTriggeredAt) {
      await triggerBranchBuild(branch);
      ctx.store.upsertIssue(issue.number, { buildTriggeredAt: new Date().toISOString() });
    }
    return;
  }

  if (build && (build.url !== state.buildUrl || build.number !== state.buildNumber)) {
    ctx.store.upsertIssue(issue.number, { buildUrl: build.url, buildNumber: build.number }, `Jenkins build #${build.number} found`);
    await updateStatus(ctx, state, { branch, sha, prUrl: state.prUrl, buildUrl: build.url, phase: "Jenkins build running", lines: [`Build #${build.number} started`] });
  }
  if (verdict === "pending") {
    if (elapsedMin > config.jenkins.timeoutMinutes) {
      await ctx.gh.createComment(issue.number, needsHumanComment(`Jenkins build ${build?.url} has not finished after ${config.jenkins.timeoutMinutes} minutes.`, "Timed out waiting for CI.", branch));
      await setStatus(ctx, issue, state, "needs_human", "Jenkins timeout", { lastError: "Jenkins timeout" });
    }
    return;
  }
  if (verdict === "success") {
    await updateStatus(ctx, state, { branch, sha, prUrl: state.prUrl, buildUrl: build!.url, buildResult: build!.result ?? undefined, phase: "Jenkins green, deploying", lines: [`Build #${build!.number} ${build!.result}`] });
    const next = await setStatus(ctx, issue, state, "deploying", `Jenkins build #${build!.number} ${build!.result}`, { buildUrl: build!.url, buildNumber: build!.number });
    return deploy(ctx, issue, next);
  }

  // failure
  const context = await failureContext(branch, build!);
  issueLog(issue.number, "jenkins", context);
  const rounds = state.ciRounds + 1;
  if (rounds > config.models.maxCiRounds) {
    await ctx.gh.createComment(issue.number, needsHumanComment(`Jenkins failed ${rounds} times for this change; last build: ${build!.url}`, truncate(context, 15_000), branch));
    await setStatus(ctx, issue, state, "needs_human", "CI failed repeatedly", { ciRounds: rounds, lastError: "CI failed repeatedly", buildUrl: build!.url });
    return;
  }
  await updateStatus(ctx, state, { branch, sha, prUrl: state.prUrl, buildUrl: build!.url, buildResult: build!.result ?? undefined, phase: `Jenkins failed, fix round ${rounds}`, lines: [`Build #${build!.number} ${build!.result} — analysing`] });
  // Hand over to the slow lane: "implementing" with ciFix set makes the loop run slowStepCiFix
  await setStatus(ctx, issue, state, "implementing", `CI failure round ${rounds}`, { ciRounds: rounds, ciFailureContext: context, buildUrl: build!.url, buildNumber: build!.number, ciFix: true });
};

const deploy = async (ctx: IssueContext, issue: IssueSummary, state: IssueState): Promise<void> => {
  const branch = state.branch!;
  const sha = state.headSha!;
  const finish = state.finish ?? { summary: "(summary unavailable)", testsAdded: [], deviations: "", notes: "" };
  if (!isDeployConfigured()) {
    log.warn("Issue", `#${issue.number}: deploy not configured; marking done without deploying`);
    await ctx.gh.createComment(
      issue.number,
      doneComment({ branch, sha, prUrl: state.prUrl, buildUrl: state.buildUrl, summary: finish.summary, testsAdded: finish.testsAdded, notes: `${finish.notes}\n\n_Deployment skipped: the bot has no tracking-server SSH configuration._`.trim(), deployHost: "(not configured)", deployOutputTail: "(skipped)" })
    );
    await setStatus(ctx, issue, state, "done", "done (deploy skipped)");
    return;
  }
  let output = "";
  try {
    const result = await deployToTrackingServer(branch, sha, (chunk) => (output += chunk));
    issueLog(issue.number, "deploy", result.output);
    if (result.ok) {
      await ctx.gh.createComment(
        issue.number,
        doneComment({
          branch,
          sha,
          prUrl: state.prUrl,
          buildUrl: state.buildUrl,
          summary: finish.summary,
          testsAdded: finish.testsAdded,
          notes: finish.notes,
          deployHost: config.deploy.host!,
          deployOutputTail: truncate(result.output, 6000).split("\n").slice(-60).join("\n"),
        })
      );
      await setStatus(ctx, issue, state, "done", "deployed", { deployedSha: sha });
      return;
    }
    const reason = result.rolledBack
      ? `Deployment of ${sha.slice(0, 10)} to \`${config.deploy.host}\` failed and was **rolled back** to the previous checkout.`
      : `Deployment of ${sha.slice(0, 10)} to \`${config.deploy.host}\` failed (exit ${result.exitCode}); the server may need attention.`;
    await ctx.gh.createComment(issue.number, needsHumanComment(reason, truncate(result.output, 15_000).split("\n").slice(-120).join("\n"), branch));
    await setStatus(ctx, issue, state, "needs_human", "deploy failed", { lastError: reason });
  } catch (error) {
    log.error("Issue", `#${issue.number}: deploy error`, error);
    const message = error instanceof Error ? error.message : String(error);
    await ctx.gh.createComment(issue.number, needsHumanComment(`Could not run the deployment on \`${config.deploy.host}\`: ${message}`, truncate(output || message, 8000), branch));
    await setStatus(ctx, issue, state, "needs_human", "deploy error", { lastError: message });
  }
};

// CI fix rounds live in the slow lane because they need the workspace
export const slowStepCiFix = async (ctx: IssueContext, issueNumber: number): Promise<void> => {
  const issue = await ctx.gh.getIssue(issueNumber);
  const comments = await ctx.gh.listComments(issueNumber);
  const state = ctx.store.getIssue(issueNumber)!;
  const branch = state.branch!;
  await git.prepareBranch(branch);
  const diff = await git.diffText({ maxChars: 60_000 });
  const outcome = await runCiFix(issue, comments, ctx.botLogin, state.plan ?? "(plan unavailable)", diff, state.ciFailureContext ?? "(no context)");
  if (outcome.blocked && /^\s*UNRELATED:/i.test(outcome.finish.summary)) {
    // Re-run CI once for a flake; do not count it as a fix round beyond this one
    log.info("Issue", `#${issue.number}: agent judged the failure unrelated — re-triggering Jenkins`);
    await triggerBranchBuild(branch);
    await setStatus(ctx, issue, state, "ci", "re-triggered Jenkins after unrelated failure", { ciStartedAt: new Date().toISOString(), buildUrl: undefined, buildNumber: undefined, buildTriggeredAt: new Date().toISOString(), ciFix: false });
    return;
  }
  ctx.store.upsertIssue(issue.number, { ciFix: false });
  await finishImplementationRound(ctx, issue, ctx.store.getIssue(issue.number)!, branch, outcome, "ci-fix");
};
