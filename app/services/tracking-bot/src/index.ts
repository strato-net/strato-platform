import http from "http";
import { config } from "./config";
import { GitHubClient } from "./github/client";
import { initFileLogging, log } from "./log";
import { IssueContext, SLOW_STATES, fastStep, slowStep, slowStepCiFix } from "./pipeline/processIssue";
import { runTriage } from "./pipeline/triage";
import { StateStore } from "./state/store";
import { ensureRepo } from "./workspace/git";
import { needsHumanComment } from "./pipeline/comments";
import { isJenkinsConfigured } from "./ci/jenkins";
import { isDeployConfigured } from "./deploy/ssh";

const MAX_SLOW_ERRORS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SlowJob {
  issueNumber: number;
  kind: "implement" | "ci-fix";
  startedAt: string;
}

let slowJob: SlowJob | null = null;
let lastPollAt: string | null = null;
let lastPollError: string | null = null;
let stopping = false;

const startStatusServer = (store: StateStore, botLogin: string): void => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body, null, 2));
    };
    if (url.pathname === "/health") return json(200, { status: true, botLogin, lastPollAt, lastPollError, slowJob });
    if (url.pathname === "/status") {
      const issues = store.allIssues().map((i) => ({
        number: i.number,
        title: i.title,
        status: i.status,
        branch: i.branch,
        headSha: i.headSha,
        prUrl: i.prUrl,
        buildUrl: i.buildUrl,
        ciRounds: i.ciRounds,
        lastError: i.lastError,
        updatedAt: i.updatedAt,
      }));
      return json(200, {
        botLogin,
        repo: `${config.github.owner}/${config.github.repo}`,
        dryRun: config.dryRun,
        models: { triage: config.models.triage, implement: config.models.implement },
        jenkins: isJenkinsConfigured(),
        deploy: isDeployConfigured(),
        lastPollAt,
        lastPollError,
        slowJob,
        issues,
      });
    }
    const match = url.pathname.match(/^\/issues\/(\d+)$/);
    if (match) {
      const state = store.getIssue(Number(match[1]));
      return state ? json(200, state) : json(404, { error: "unknown issue" });
    }
    json(404, { error: "not found" });
  });
  server.listen(config.port, () => log.info("Bot", `status server on :${config.port} (/health, /status, /issues/:n)`));
};

const runSlowLane = (ctx: IssueContext, issueNumber: number, kind: SlowJob["kind"]): void => {
  slowJob = { issueNumber, kind, startedAt: new Date().toISOString() };
  const work = kind === "ci-fix" ? slowStepCiFix(ctx, issueNumber) : slowStep(ctx, issueNumber);
  work
    .catch(async (error) => {
      log.error("Bot", `slow lane failed for #${issueNumber}`, error);
      const message = error instanceof Error ? error.message : String(error);
      const errors = (ctx.store.getIssue(issueNumber)?.errors ?? 0) + 1;
      // Retried next poll; after MAX_SLOW_ERRORS in a row the issue is parked
      // with a comment instead of burning tokens forever
      if (errors >= MAX_SLOW_ERRORS) {
        const state = ctx.store.getIssue(issueNumber);
        await ctx.gh
          .createComment(issueNumber, needsHumanComment(`The bot hit an internal error ${errors} times in a row while working on this issue.`, message.slice(0, 4000), state?.branch))
          .catch((e) => log.warn("Bot", `could not post needs-human comment: ${e}`));
        ctx.store.upsertIssue(issueNumber, { status: "needs_human", lastError: message, errors: 0 }, `parked after ${errors} errors`);
      } else {
        ctx.store.upsertIssue(issueNumber, { lastError: message, errors }, `error ${errors}: ${message.slice(0, 200)}`);
      }
    })
    .finally(() => {
      slowJob = null;
    });
};

const pollOnce = async (ctx: IssueContext): Promise<void> => {
  const { gh, store, botLogin } = ctx;
  await runTriage(gh, store, botLogin);

  const allow = config.github.issueAllowlist;
  const assigned = (await gh.listOpenIssues({ assignee: botLogin })).filter((i) => !allow.length || allow.includes(i.number));
  const assignedNumbers = new Set(assigned.map((i) => i.number));
  for (const issue of assigned) {
    if (slowJob?.issueNumber === issue.number) continue; // the slow lane owns it right now
    try {
      await fastStep(ctx, issue);
    } catch (error) {
      log.error("Bot", `fast step failed for #${issue.number}`, error);
    }
  }
  // Issues we know about that are no longer open+assigned to us
  for (const state of store.allIssues()) {
    if (allow.length && !allow.includes(state.number)) continue;
    if (state.status === "closed" || assignedNumbers.has(state.number) || slowJob?.issueNumber === state.number) continue;
    store.upsertIssue(state.number, { status: "closed" }, "closed or unassigned");
    log.info("Bot", `#${state.number}: no longer open and assigned to the bot; parked`);
  }

  if (!slowJob) {
    const candidate = store
      .allIssues()
      .filter((s) => assignedNumbers.has(s.number) && SLOW_STATES.includes(s.status))
      .sort((a, b) => (Number(b.ciFix ?? false) - Number(a.ciFix ?? false)) || a.number - b.number)[0];
    if (candidate) {
      runSlowLane(ctx, candidate.number, candidate.status === "implementing" && candidate.ciFix ? "ci-fix" : "implement");
    }
  }
};

const main = async (): Promise<void> => {
  initFileLogging(config.workspace.logsDir);
  log.info("Bot", `starting (dryRun=${config.dryRun}, repo=${config.github.owner}/${config.github.repo}, base=${config.github.baseBranch})`);
  log.info("Bot", `models: triage=${config.models.triage.provider}:${config.models.triage.model} implement=${config.models.implement.provider}:${config.models.implement.model} effort=${config.models.effort}`);
  if (!isJenkinsConfigured()) log.warn("Bot", "Jenkins is not configured — the CI gate will be skipped");
  if (!isDeployConfigured()) log.warn("Bot", "Deploy is not configured — deployments will be skipped");

  const store = new StateStore(config.workspace.stateFile);
  const gh = new GitHubClient();
  const botLogin = await gh.botLogin();
  log.info("Bot", `GitHub identity: ${botLogin}`);
  await ensureRepo();
  const ctx: IssueContext = { gh, store, botLogin };
  startStatusServer(store, botLogin);

  process.on("SIGTERM", () => {
    stopping = true;
    log.info("Bot", "SIGTERM received; exiting after the current poll");
  });
  process.on("SIGINT", () => {
    stopping = true;
    log.info("Bot", "SIGINT received; exiting after the current poll");
  });

  while (!stopping) {
    const started = Date.now();
    try {
      await pollOnce(ctx);
      lastPollError = null;
    } catch (error) {
      lastPollError = error instanceof Error ? error.message : String(error);
      log.error("Bot", "poll failed", error);
    }
    lastPollAt = new Date().toISOString();
    const elapsed = Date.now() - started;
    await sleep(Math.max(5_000, config.pollIntervalMs - elapsed));
  }
  process.exit(0);
};

main().catch((error) => {
  log.error("Bot", "fatal", error);
  process.exit(1);
});
