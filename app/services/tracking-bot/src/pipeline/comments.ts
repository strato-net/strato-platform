// Markdown bodies the bot posts. Each carries an HTML marker so the bot can
// recognise its own comment types when re-reading a conversation.

export const MARK = {
  decline: "<!-- tracking-bot:decline -->",
  clarify: "<!-- tracking-bot:clarify -->",
  plan: "<!-- tracking-bot:plan -->",
  status: "<!-- tracking-bot:status -->",
  done: "<!-- tracking-bot:done -->",
  needsHuman: "<!-- tracking-bot:needs-human -->",
};

const HEADER = "### 🤖 Tracking bot";

export const CRITERIA = {
  assigned: "1 — the issue is assigned to the bot's GitHub account",
  coreTeam: "2 — the issue creator is a member of the strato-net core team",
  scope: "3 — the scope of the issue is limited to changes to the tracking UI, API, server code, or migrations to the tracking database",
};

export const declineCriterionComment = (criterion: string, description: string): string =>
  `${MARK.decline}
${HEADER}: not picking this up

**Unmet selection criterion:** ${criterion}

${description}

_If this is a mistake, edit the issue or reply here and I will re-evaluate. Unassign me to stop._`;

export const declineDecisionComment = (reason: string): string =>
  `${MARK.decline}
${HEADER}: not implementing

All selection criteria are met, but after reading the full conversation I decided not to implement this:

${reason}

_Reply here if you disagree or want to narrow the request, and I will re-evaluate._`;

export const replyComment = (body: string): string => `${HEADER}

${body.trim()}`;

export const clarifyComment = (questions: string[], reason: string): string =>
  `${MARK.clarify}
${HEADER}: need clarification before implementing

${reason}

${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

_Answer in a comment and I will pick this up again._`;

export interface PlanBody {
  summary: string;
  steps: string[];
  files: { path: string; change: string }[];
  migration: string;
  tests: string[];
  risks: string[];
  assumptions: string[];
}

export const renderPlan = (plan: PlanBody): string => {
  const lines = [`**Summary.** ${plan.summary}`, ""];
  if (plan.assumptions.length) lines.push("**Assumptions**", ...plan.assumptions.map((a) => `- ${a}`), "");
  lines.push("**Steps**", ...plan.steps.map((s, i) => `${i + 1}. ${s}`), "");
  if (plan.files.length) lines.push("**Files**", ...plan.files.map((f) => `- \`${f.path}\` — ${f.change}`), "");
  if (plan.migration.trim()) lines.push("**Database migration**", plan.migration, "");
  lines.push("**Tests** (run in the Tracking Server Tests Jenkins stage)", ...plan.tests.map((t) => `- ${t}`), "");
  if (plan.risks.length) lines.push("**Risks / notes**", ...plan.risks.map((r) => `- ${r}`), "");
  return lines.join("\n").trim();
};

export const planComment = (plan: PlanBody, branch: string, isFollowUp: boolean): string =>
  `${MARK.plan}
${HEADER}: ${isFollowUp ? "follow-up plan" : "implementation plan"}

${renderPlan(plan)}

I will now implement this on branch \`${branch}\`, wait for the Jenkins build, and deploy it to the tracking server. Comment here at any time to change course.`;

export interface StatusFields {
  branch: string;
  sha?: string;
  prUrl?: string;
  buildUrl?: string;
  buildResult?: string;
  ciRound?: number;
  phase: string; // human-readable current phase
  lines?: string[]; // history lines
}

export const statusComment = (s: StatusFields): string =>
  `${MARK.status}
${HEADER}: status — ${s.phase}

- Branch: \`${s.branch}\`${s.sha ? ` @ ${s.sha.slice(0, 10)}` : ""}
${s.prUrl ? `- Pull request: ${s.prUrl}\n` : ""}${s.buildUrl ? `- Jenkins: ${s.buildUrl}${s.buildResult ? ` (${s.buildResult})` : ""}\n` : ""}${s.lines?.length ? "\n" + s.lines.map((l) => `- ${l}`).join("\n") : ""}`;

export const doneComment = (fields: {
  branch: string;
  sha: string;
  prUrl?: string;
  buildUrl?: string;
  summary: string;
  testsAdded: string[];
  notes: string;
  deployHost: string;
  deployOutputTail: string;
}): string =>
  `${MARK.done}
${HEADER}: deployed ✅

${fields.summary}

**Tests**
${fields.testsAdded.map((t) => `- ${t}`).join("\n") || "- (see branch)"}
${fields.notes.trim() ? `\n**Notes**\n${fields.notes}\n` : ""}
**Delivery**
- Branch \`${fields.branch}\` @ ${fields.sha.slice(0, 10)}${fields.prUrl ? ` — ${fields.prUrl}` : ""}
${fields.buildUrl ? `- Jenkins build: ${fields.buildUrl}\n` : ""}- Deployed to \`${fields.deployHost}\` (branch pulled, images rebuilt, compose stack updated)

<details><summary>Deploy log tail</summary>

\`\`\`
${fields.deployOutputTail}
\`\`\`
</details>

_Reply here with follow-up changes and I will implement them on the same branch. Merging the PR is up to the team._`;

export const needsHumanComment = (reason: string, details: string, branch?: string): string =>
  `${MARK.needsHuman}
${HEADER}: needs a human 🙋

${reason}
${branch ? `\nThe work so far is on branch \`${branch}\`.\n` : ""}
<details><summary>Details</summary>

\`\`\`
${details}
\`\`\`
</details>

_Reply here after addressing this and I will try again._`;
