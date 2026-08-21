import { config } from "../config";
import { log } from "../log";
import { truncate } from "../agent/tools";

// Read-mostly Jenkins client for a multibranch pipeline job: find the build
// for a commit, read overall + per-stage status (Pipeline Stage View wfapi),
// pull failure logs, and trigger a branch build / branch scan when needed.

export interface StageStatus {
  id: string;
  name: string;
  status: string; // SUCCESS | FAILED | UNSTABLE | IN_PROGRESS | NOT_EXECUTED | ABORTED | ...
}

export interface BuildInfo {
  number: number;
  url: string;
  building: boolean;
  result: string | null; // SUCCESS | UNSTABLE | FAILURE | ABORTED | NOT_BUILT | null (running)
  timestamp: number;
  stages: StageStatus[];
}

export type BuildVerdict = "pending" | "success" | "failure" | "not_found";

const enabled = (): boolean => config.jenkins.enabled && Boolean(config.jenkins.url && config.jenkins.job);

const authHeader = (): Record<string, string> => {
  if (!config.jenkins.user || !config.jenkins.token) return {};
  return { Authorization: "Basic " + Buffer.from(`${config.jenkins.user}:${config.jenkins.token}`).toString("base64") };
};

const jobPath = (): string =>
  (config.jenkins.job ?? "")
    .split("/")
    .filter((seg) => seg && seg !== "job")
    .map((seg) => `job/${encodeURIComponent(seg)}`)
    .join("/");

export const multibranchUrl = (): string => `${config.jenkins.url}/${jobPath()}`;
export const branchJobUrl = (branch: string): string => `${multibranchUrl()}/job/${encodeURIComponent(branch)}`;

const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const res = await fetch(url, { ...init, headers: { ...authHeader(), ...(init.headers as Record<string, string> | undefined) } });
  return res;
};

const getJson = async <T>(url: string): Promise<T | null> => {
  const res = await request(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Jenkins ${res.status} for ${url}`);
  return (await res.json()) as T;
};

const shaOfBuild = (build: any): string[] => {
  const shas: string[] = [];
  for (const action of build.actions ?? []) {
    if (action?.lastBuiltRevision?.SHA1) shas.push(action.lastBuiltRevision.SHA1);
    if (action?.revision?.SHA1) shas.push(action.revision.SHA1);
    for (const branch of action?.lastBuiltRevision?.branch ?? []) if (branch?.SHA1) shas.push(branch.SHA1);
  }
  return shas.map((s) => s.toLowerCase());
};

const stagesOf = async (branch: string, number: number): Promise<StageStatus[]> => {
  try {
    const wf = await getJson<{ stages?: any[] }>(`${branchJobUrl(branch)}/${number}/wfapi/describe`);
    return (wf?.stages ?? []).map((s) => ({ id: String(s.id), name: String(s.name), status: String(s.status) }));
  } catch (error) {
    log.warn("Jenkins", `wfapi unavailable for build ${number}: ${error}`);
    return [];
  }
};

// The build (if any) for the given commit on the branch job
export const findBuildForSha = async (branch: string, sha: string): Promise<BuildInfo | null> => {
  if (!enabled()) return null;
  // Brackets must be percent-encoded: the Cloudflare/Jenkins front returns an
  // empty body for raw "[" in the query string
  const tree = encodeURIComponent("builds[number,url,result,building,timestamp,actions[lastBuiltRevision[SHA1,branch[SHA1]],revision[SHA1]]]{0,40}");
  const data = await getJson<{ builds?: any[] }>(`${branchJobUrl(branch)}/api/json?tree=${tree}`);
  if (!data) return null; // branch job not indexed yet
  const target = sha.toLowerCase();
  const build = (data.builds ?? []).find((b) => shaOfBuild(b).includes(target));
  if (!build) return null;
  return {
    number: build.number,
    url: build.url,
    building: Boolean(build.building),
    result: build.result ?? null,
    timestamp: build.timestamp ?? 0,
    stages: await stagesOf(branch, build.number),
  };
};

export const branchJobExists = async (branch: string): Promise<boolean> => {
  if (!enabled()) return false;
  const res = await request(`${branchJobUrl(branch)}/api/json?tree=name`);
  return res.ok && (await res.text()).includes("name");
};

// "Scan Multibranch Pipeline Now" — makes Jenkins discover a new branch
export const triggerBranchScan = async (): Promise<void> => {
  if (!enabled() || config.dryRun) return;
  const res = await request(`${multibranchUrl()}/build?delay=0`, { method: "POST" });
  log.info("Jenkins", `branch scan triggered (${res.status})`);
};

export const triggerBranchBuild = async (branch: string): Promise<void> => {
  if (!enabled() || config.dryRun) return;
  const res = await request(`${branchJobUrl(branch)}/build?delay=0`, { method: "POST" });
  log.info("Jenkins", `build triggered for ${branch} (${res.status})`);
};

// Success = overall SUCCESS, or UNSTABLE with every required stage green when
// acceptUnstable is on (contract tests mark the build UNSTABLE on failure and
// are unrelated to the tracking server).
export const evaluateBuild = (build: BuildInfo | null): BuildVerdict => {
  if (!build) return "not_found";
  if (build.building || build.result === null) return "pending";
  if (build.result === "SUCCESS") return "success";
  if (build.result === "UNSTABLE" && config.jenkins.acceptUnstable) {
    const required = config.jenkins.requiredStages.map((s) => s.toLowerCase());
    const stageOk = (name: string) => {
      const stage = build.stages.find((s) => s.name.toLowerCase() === name);
      return stage ? stage.status === "SUCCESS" : false;
    };
    if (required.every(stageOk)) return "success";
    // If wfapi is unavailable we cannot prove the required stages passed
    if (build.stages.length === 0) log.warn("Jenkins", `build ${build.number} UNSTABLE and no stage data; treating as failure`);
  }
  return "failure";
};

const consoleTail = async (branch: string, number: number, maxChars: number): Promise<string> => {
  const res = await request(`${branchJobUrl(branch)}/${number}/consoleText`);
  if (!res.ok) return `(console unavailable: ${res.status})`;
  const text = await res.text();
  return text.length > maxChars ? text.slice(-maxChars) : text;
};

// Failure context for the fixing agent: failed stages + their logs (or the
// console tail when per-stage logs are unavailable).
export const failureContext = async (branch: string, build: BuildInfo): Promise<string> => {
  const parts: string[] = [`Jenkins build #${build.number} result: ${build.result} — ${build.url}`];
  const failed = build.stages.filter((s) => ["FAILED", "UNSTABLE", "ABORTED"].includes(s.status));
  parts.push(
    "Stages: " + (build.stages.map((s) => `${s.name}=${s.status}`).join(", ") || "(no stage data)")
  );
  const requiredLower = config.jenkins.requiredStages.map((s) => s.toLowerCase());
  const interesting = failed.filter((s) => requiredLower.includes(s.name.toLowerCase())).concat(failed.filter((s) => !requiredLower.includes(s.name.toLowerCase())));
  // Logs hang off the step nodes inside a stage (the stage node itself has
  // none): describe the stage, then read the failed steps' log tails
  let gotStageLog = false;
  for (const stage of interesting.slice(0, 3)) {
    try {
      const described = await getJson<{ stageFlowNodes?: { id: string; name: string; status: string }[] }>(
        `${branchJobUrl(branch)}/${build.number}/execution/node/${stage.id}/wfapi/describe`
      );
      const nodes = described?.stageFlowNodes ?? [];
      const failedNodes = nodes.filter((n) => ["FAILED", "UNSTABLE", "ABORTED"].includes(n.status));
      const chosen = (failedNodes.length ? failedNodes : nodes.slice(-2)).slice(-3);
      for (const node of chosen) {
        const nodeLog = await getJson<{ text?: string }>(`${branchJobUrl(branch)}/${build.number}/execution/node/${node.id}/wfapi/log`);
        if (nodeLog?.text) {
          gotStageLog = true;
          parts.push(`--- stage "${stage.name}" / step "${node.name}" (${node.status}) log tail ---\n${truncate(nodeLog.text, 20_000)}`);
        }
      }
    } catch (error) {
      log.warn("Jenkins", `stage log unavailable for ${stage.name}: ${error}`);
    }
  }
  if (!gotStageLog) {
    parts.push(`--- console tail ---\n${await consoleTail(branch, build.number, 40_000)}`);
  }
  return parts.join("\n\n");
};

export const isJenkinsConfigured = enabled;
