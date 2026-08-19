// Offline smoke test of the slow lane without GitHub: fabricate an issue,
// run plan → implement → policy/validation → commit on the workspace clone.
//   WORKSPACE_DIR=... GIT_REMOTE_URL=... ANTHROPIC_API_KEY=... node dist/scripts/smokeImplement.js
import { config } from "../config";
import { initFileLogging } from "../log";
import { IssueSummary } from "../github/client";
import { generatePlan, runImplementation } from "../agent/runner";
import { renderPlan } from "../pipeline/comments";
import * as git from "../workspace/git";
import { failureDetails } from "../workspace/checks";

const issue: IssueSummary = {
  number: Number(process.env.SMOKE_ISSUE_NUMBER ?? 9999),
  title: process.env.SMOKE_TITLE ?? "Expose the tracking service version on a public endpoint",
  body:
    process.env.SMOKE_BODY ??
    `Ops wants to see which tracking build is live without shelling into the box.

Add \`GET /tracking-api/version\` (no auth, like /health) returning JSON \`{ "name": "<package name>", "version": "<package version>", "startedAt": "<ISO timestamp of process start>" }\`. Read name/version from package.json at startup. Document it in the README endpoint table and cover it with an integration test.`,
  state: "open",
  user: { login: "mvoyevoda", type: "User" },
  assignees: ["strato-tracking-bot"],
  labels: ["tracking"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  htmlUrl: "https://github.com/strato-net/strato-platform/issues/9999",
  isPullRequest: false,
};

const main = async () => {
  initFileLogging(config.workspace.logsDir);
  await git.ensureRepo();
  const branch = `${config.github.branchPrefix}issue-${issue.number}-smoke`;
  const prepared = await git.prepareBranch(branch);
  console.log("branch prepared", prepared);
  console.time("plan");
  const plan = await generatePlan(issue, [], "strato-tracking-bot", { assumptions: [], isFollowUp: false }, "");
  console.timeEnd("plan");
  const planText = renderPlan(plan);
  console.log("=== PLAN ===\n" + planText + "\n");
  console.time("implement");
  const outcome = await runImplementation(issue, [], "strato-tracking-bot", planText, "");
  console.timeEnd("implement");
  console.log("=== OUTCOME ===", { ok: outcome.ok, blocked: outcome.blocked, rounds: outcome.rounds, files: outcome.changedFiles });
  console.log("finish:", JSON.stringify(outcome.finish, null, 2));
  console.log("policy:", outcome.policy.problems);
  if (outcome.validation) console.log("validation:\n" + outcome.validation.summary + "\n" + failureDetails(outcome.validation));
  if (outcome.ok) {
    if (config.workspace.regenerateBuildMetadata) await git.regenerateBuildMetadata();
    const sha = await git.commitAll(`${issue.title} (#${issue.number})\n\n${outcome.finish.summary}`);
    console.log("committed", sha, "\n" + (await git.diffStat()));
  }
};

main().catch((e) => {
  console.error("smoke failed", e);
  process.exit(1);
});
