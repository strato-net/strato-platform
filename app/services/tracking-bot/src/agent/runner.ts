import { config } from "../config";
import { IssueComment, IssueSummary } from "../github/client";
import { implementClient, triageClient } from "../llm/registry";
import { ImageInput, ToolDefinition, TurnResult } from "../llm/types";
import { issueLog, log } from "../log";
import { PlanBody } from "../pipeline/comments";
import { checkDiffPolicy, failureDetails, runLocalValidation, ValidationReport, PolicyVerdict } from "../workspace/checks";
import { branchChangedFiles } from "../workspace/git";
import {
  CI_FIX_SYSTEM,
  FINISH_SCHEMA,
  FINISH_TOOL,
  IMPLEMENT_SYSTEM,
  PLAN_SCHEMA,
  PLAN_SYSTEM,
  PLAN_TOOL,
  ciFixUser,
  implementUser,
  planUser,
  validationFailedUser,
} from "./prompts";
import { createToolExecutor, fullTools, readOnlyTools } from "./tools";

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];

const toPlan = (raw: Record<string, unknown> | undefined): PlanBody => ({
  summary: String(raw?.summary ?? "").trim() || "(no summary provided)",
  steps: asStringArray(raw?.steps),
  files: Array.isArray(raw?.files)
    ? (raw!.files as any[]).map((f) => ({ path: String(f?.path ?? ""), change: String(f?.change ?? "") })).filter((f) => f.path)
    : [],
  migration: String(raw?.migration ?? ""),
  tests: asStringArray(raw?.tests),
  risks: asStringArray(raw?.risks),
  assumptions: asStringArray(raw?.assumptions),
});

export interface FinishOutput {
  summary: string;
  testsAdded: string[];
  deviations: string;
  notes: string;
}

const toFinish = (raw: Record<string, unknown> | undefined, fallbackText: string): FinishOutput => ({
  summary: String(raw?.summary ?? "").trim() || fallbackText.trim() || "(no summary provided)",
  testsAdded: asStringArray(raw?.testsAdded),
  deviations: String(raw?.deviations ?? ""),
  notes: String(raw?.notes ?? ""),
});

const planTool: ToolDefinition = { name: PLAN_TOOL, description: "Submit the finished implementation plan. Call exactly once, after reading the relevant code.", inputSchema: PLAN_SCHEMA };
const finishTool: ToolDefinition = { name: FINISH_TOOL, description: "Signal that the implementation is complete and verified. Call once at the end.", inputSchema: FINISH_SCHEMA };

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------
export const generatePlan = async (
  issue: IssueSummary,
  comments: IssueComment[],
  botLogin: string,
  screening: { assumptions: string[]; isFollowUp: boolean },
  priorContext: string,
  images: ImageInput[] = []
): Promise<PlanBody> => {
  const client = implementClient();
  const execute = createToolExecutor({ repoDir: config.workspace.repoDir, writable: false, allowedPaths: [] });
  const session = client.createSession({
    system: PLAN_SYSTEM,
    tools: [...readOnlyTools(), planTool],
    execute,
    maxTurns: 80,
    stopTool: PLAN_TOOL,
    label: `plan#${issue.number}`,
    onText: (text) => issueLog(issue.number, "plan", `[assistant]\n${text}`),
    onToolCall: (name, input) => issueLog(issue.number, "plan", `[tool] ${name} ${JSON.stringify(input).slice(0, 500)}`),
  });
  let result: TurnResult = await session.send(planUser(issue, comments, botLogin, screening, priorContext, images.length), images);
  if (result.stoppedBy !== "stop_tool") {
    log.warn("Runner", `plan#${issue.number}: model ended without ${PLAN_TOOL} (${result.stoppedBy}); nudging once`);
    result = await session.send(`You must call ${PLAN_TOOL} with the plan now.`);
  }
  if (result.stoppedBy !== "stop_tool") throw new Error(`Planning ended without a plan (${result.stoppedBy})`);
  log.info("Runner", `plan#${issue.number}: done in ${result.turns} turns (${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens)`);
  return toPlan(result.stopToolInput);
};

// ---------------------------------------------------------------------------
// Implementation + local fix rounds
// ---------------------------------------------------------------------------
export interface ImplementOutcome {
  finish: FinishOutput;
  policy: PolicyVerdict;
  validation: ValidationReport | null;
  changedFiles: string[];
  ok: boolean;
  blocked: boolean;
  rounds: number;
}

const settle = async (
  issueNumber: number,
  finish: FinishOutput,
  rounds: number,
  onOutput: (s: string) => void
): Promise<Omit<ImplementOutcome, "finish" | "rounds" | "blocked">> => {
  const changedFiles = await branchChangedFiles();
  const policy = checkDiffPolicy(changedFiles);
  issueLog(issueNumber, "implement", `[policy] files=${changedFiles.join(", ")}\n${policy.problems.join("\n") || "ok"}`);
  if (!policy.ok) return { policy, validation: null, changedFiles, ok: false };
  const validation = await runLocalValidation(changedFiles, `tbot-${issueNumber}`, onOutput);
  issueLog(issueNumber, "implement", `[validation]\n${validation.summary}\n${failureDetails(validation)}`);
  return { policy, validation, changedFiles, ok: validation.ok };
};

const runAgentWithFixes = async (
  issueNumber: number,
  system: string,
  firstMessage: string,
  label: string,
  images: ImageInput[] = []
): Promise<ImplementOutcome> => {
  const client = implementClient();
  const onLog = (line: string) => issueLog(issueNumber, label, line);
  const execute = createToolExecutor({ repoDir: config.workspace.repoDir, writable: true, allowedPaths: config.workspace.allowedPaths, onLog });
  const session = client.createSession({
    system,
    tools: [...fullTools(), finishTool],
    execute,
    maxTurns: config.models.maxAgentTurns,
    stopTool: FINISH_TOOL,
    label: `${label}#${issueNumber}`,
    onText: (text) => onLog(`[assistant]\n${text}`),
    onToolCall: (name, input) => name !== "bash" && onLog(`[tool] ${name} ${JSON.stringify(input).slice(0, 300)}`),
  });

  let message = firstMessage;
  let rounds = 0;
  let last: ImplementOutcome | null = null;
  while (true) {
    rounds++;
    let result = await session.send(message, rounds === 1 ? images : undefined);
    if (result.stoppedBy === "end_turn") {
      result = await session.send(`When the work is complete and verified, call ${FINISH_TOOL}. If you are blocked, call it with a summary starting with "BLOCKED:".`);
    }
    if (result.stoppedBy === "max_turns") {
      const finish = toFinish(undefined, "BLOCKED: the agent ran out of turns before finishing.");
      return { finish, policy: { ok: false, disallowed: [], missingTests: false, problems: ["agent ran out of turns"] }, validation: null, changedFiles: await branchChangedFiles(), ok: false, blocked: true, rounds };
    }
    const finish = toFinish(result.stopToolInput, result.finalText);
    log.info("Runner", `${label}#${issueNumber}: round ${rounds} finished (${result.turns} turns, ${result.usage.inputTokens} in / ${result.usage.outputTokens} out)`);
    const blocked = /^\s*(BLOCKED|UNRELATED):/i.test(finish.summary);
    if (blocked) {
      return { finish, policy: { ok: true, disallowed: [], missingTests: false, problems: [] }, validation: null, changedFiles: await branchChangedFiles(), ok: false, blocked: true, rounds };
    }
    const settled = await settle(issueNumber, finish, rounds, (s) => onLog(s.trimEnd()));
    last = { finish, ...settled, blocked: false, rounds };
    if (settled.ok) return last;
    if (rounds > config.models.maxFixRounds) return last;
    const problems = settled.policy.ok ? ["Local validation failed (see details)."] : settled.policy.problems;
    const details = settled.validation ? `Validation summary:\n${settled.validation.summary}\n\n${failureDetails(settled.validation)}` : "";
    message = validationFailedUser(problems, details);
  }
};

export const runImplementation = (
  issue: IssueSummary,
  comments: IssueComment[],
  botLogin: string,
  plan: string,
  extra: string,
  images: ImageInput[] = []
): Promise<ImplementOutcome> =>
  runAgentWithFixes(issue.number, IMPLEMENT_SYSTEM, implementUser(issue, comments, botLogin, plan, extra, images.length), "implement", images);

export const runCiFix = (
  issue: IssueSummary,
  comments: IssueComment[],
  botLogin: string,
  plan: string,
  diff: string,
  jenkinsContext: string
): Promise<ImplementOutcome> =>
  runAgentWithFixes(issue.number, CI_FIX_SYSTEM, ciFixUser(issue, comments, botLogin, plan, diff, jenkinsContext), "ci-fix");

// Cheap structured calls (classification, screening) go through the triage model
export const structuredTriage = triageClient;
