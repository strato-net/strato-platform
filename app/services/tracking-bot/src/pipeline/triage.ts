import crypto from "crypto";
import { config } from "../config";
import { GitHubClient, IssueSummary } from "../github/client";
import { triageClient } from "../llm/registry";
import { log } from "../log";
import { StateStore } from "../state/store";
import { TRIAGE_SCHEMA, TRIAGE_SYSTEM, triageUser } from "../agent/prompts";

// Poll open issues; self-assign the ones about the tracking server. Labels
// give a deterministic yes; otherwise the triage model classifies once per
// distinct (title, body, labels) content.

const contentHash = (issue: IssueSummary): string =>
  crypto.createHash("sha1").update(`${issue.title}\n${issue.body}\n${[...issue.labels].sort().join(",")}`).digest("hex");

interface Classification {
  relevant: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

const classify = async (issue: IssueSummary): Promise<Classification> =>
  triageClient().structured<Classification>({
    system: TRIAGE_SYSTEM,
    user: triageUser(issue),
    name: "classify_issue",
    description: "Record whether the issue is about the tracking server",
    schema: TRIAGE_SCHEMA,
    validate: (v: any) => ({
      relevant: Boolean(v?.relevant),
      confidence: (["high", "medium", "low"].includes(v?.confidence) ? v.confidence : "low") as Classification["confidence"],
      reason: String(v?.reason ?? ""),
    }),
  });

let lastPollAt: string | null = null;

export const runTriage = async (gh: GitHubClient, store: StateStore, botLogin: string): Promise<void> => {
  // Overlap the window so a comment/edit landing mid-poll is never missed
  const since = lastPollAt
    ? new Date(new Date(lastPollAt).getTime() - 10 * 60_000).toISOString()
    : new Date(Date.now() - config.github.triageLookbackDays * 24 * 3600_000).toISOString();
  const startedAt = new Date().toISOString();
  const issues = await gh.listOpenIssues({ since });
  lastPollAt = startedAt;

  for (const issue of issues) {
    if (config.github.issueAllowlist.length && !config.github.issueAllowlist.includes(issue.number)) continue;
    if (issue.assignees.includes(botLogin)) continue;
    if (issue.user.login === botLogin) continue;
    if (config.github.triageSkipHumanAssigned && issue.assignees.length > 0) continue;

    const hash = contentHash(issue);
    const prior = store.getTriage(issue.number);
    if (prior && prior.contentHash === hash) continue; // same content already classified

    let relevant = false;
    let reason = "";
    const labelHit = issue.labels.map((l) => l.toLowerCase()).find((l) => config.github.triageLabels.includes(l));
    if (labelHit) {
      relevant = true;
      reason = `label "${labelHit}"`;
    } else if (config.github.triageUseAi) {
      try {
        const verdict = await classify(issue);
        relevant = verdict.relevant && verdict.confidence !== "low";
        reason = `${verdict.relevant ? "relevant" : "not relevant"} (${verdict.confidence}): ${verdict.reason}`;
      } catch (error) {
        log.error("Triage", `classification failed for #${issue.number}`, error);
        continue; // retry next poll
      }
    }

    log.info("Triage", `#${issue.number} "${issue.title}": ${relevant ? "TRACKING" : "other"} — ${reason}`);
    if (relevant) {
      await gh.addAssignee(issue.number, botLogin);
      await gh.setBotLabel(issue.number, issue.labels, `${config.github.labelPrefix}:queued`).catch((e) => log.warn("Triage", `label failed: ${e}`));
    }
    store.setTriage({ number: issue.number, contentHash: hash, relevant, reason, assigned: relevant, at: new Date().toISOString() });
  }
};
