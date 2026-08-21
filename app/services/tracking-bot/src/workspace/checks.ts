import fs from "fs";
import path from "path";
import { config } from "../config";
import { log } from "../log";
import { runShell, truncate } from "../agent/tools";
import { matchesAny } from "./paths";

// Deterministic guardrails applied to every agent result before anything is
// committed: path allowlist, test requirement, and local build/test runs.

export interface PolicyVerdict {
  ok: boolean;
  disallowed: string[];
  missingTests: boolean;
  problems: string[];
}

export const checkDiffPolicy = (files: string[]): PolicyVerdict => {
  const disallowed = files.filter((f) => !matchesAny(f, config.workspace.allowedPaths));
  const substantive = files.filter((f) => !matchesAny(f, config.workspace.testExemptPaths) && f !== "BUILD_METADATA");
  const hasTests = files.some((f) => matchesAny(f, config.workspace.requiredTestPaths));
  const missingTests = substantive.length > 0 && !hasTests;
  const problems: string[] = [];
  if (files.length === 0) problems.push("The working tree has no changes.");
  if (disallowed.length) {
    problems.push(
      `These files are outside the allowed area (${config.workspace.allowedPaths.join(", ")}) and must be reverted: ${disallowed.join(", ")}`
    );
  }
  if (missingTests) {
    problems.push(
      `No integration test changes found under ${config.workspace.requiredTestPaths.join(", ")}. Every change must ship with tests that run in the Tracking Server Tests Jenkins stage (see app/services/tracking/test/README.md).`
    );
  }
  return { ok: problems.length === 0, disallowed, missingTests, problems };
};

export interface CheckStep {
  name: string;
  ok: boolean;
  skipped?: boolean;
  output: string;
  durationMs: number;
}

export interface ValidationReport {
  ok: boolean;
  steps: CheckStep[];
  summary: string;
}

const service = config.workspace.servicePath;

const runStep = async (name: string, command: string, timeoutMs: number, onOutput?: (s: string) => void): Promise<CheckStep> => {
  const started = Date.now();
  log.info("Checks", `${name}: ${command}`);
  const result = await runShell(command, { cwd: config.workspace.repoDir, timeoutMs, onOutput });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n--- stderr ---\n");
  const ok = result.code === 0 && !result.timedOut;
  log.info("Checks", `${name}: ${ok ? "ok" : `FAILED (${result.timedOut ? "timeout" : `exit ${result.code}`})`} in ${Math.round((Date.now() - started) / 1000)}s`);
  return { name, ok, output: truncate(output, 16_000), durationMs: Date.now() - started };
};

const dockerAvailable = async (): Promise<boolean> => {
  const result = await runShell("docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1", {
    cwd: config.workspace.repoDir,
    timeoutMs: 30_000,
  });
  return result.code === 0;
};

// Which sub-projects the change touches decides which checks run
export const runLocalValidation = async (changedFiles: string[], projectTag: string, onOutput?: (s: string) => void): Promise<ValidationReport> => {
  const touches = (prefix: string) => changedFiles.some((f) => f.startsWith(prefix));
  const serviceChanged = changedFiles.some(
    (f) => f.startsWith(`${service}/`) && !f.startsWith(`${service}/ui/`) && !f.startsWith(`${service}/test/`) && !f.startsWith(`${service}/nginx/`)
  );
  const uiChanged = touches(`${service}/ui/`);
  const testsChanged = touches(`${service}/test/`);
  const nginxChanged = touches(`${service}/nginx/`);
  const composeChanged = changedFiles.includes("docker-compose.tracking.tpl.yml");
  const steps: CheckStep[] = [];

  if (serviceChanged) {
    steps.push(await runStep("service typecheck", `cd ${service} && npm ci --no-audit --no-fund && npx tsc --noEmit`, 10 * 60_000, onOutput));
  }
  if (uiChanged) {
    steps.push(await runStep("ui build", `cd ${service}/ui && npm ci --no-audit --no-fund && npm run build`, 15 * 60_000, onOutput));
  }
  if (testsChanged) {
    steps.push(await runStep("tests typecheck", `cd ${service}/test && npm ci --no-audit --no-fund && npx tsc --noEmit`, 10 * 60_000, onOutput));
  }
  if (nginxChanged) {
    steps.push(await runStep("nginx image build", `docker build -q ${service}/nginx`, 10 * 60_000, onOutput));
  }
  if (composeChanged) {
    steps.push(await runStep("compose template lint", `make docker-compose >/dev/null && docker compose -f docker-compose.tracking.yml config -q`, 5 * 60_000, onOutput));
  }

  const needsIntegration = serviceChanged || testsChanged || (steps.length === 0 && changedFiles.some((f) => f.startsWith(`${service}/`)));
  if (config.workspace.localTests && needsIntegration && steps.every((s) => s.ok)) {
    if (await dockerAvailable()) {
      const compose = `docker compose -f docker-compose.test.yml -p ${projectTag}`;
      const step = await runStep(
        "integration tests (docker compose)",
        `cd ${service} && ${compose} down -v --remove-orphans >/dev/null 2>&1; ${compose} up --build --abort-on-container-exit --exit-code-from tests; code=$?; ${compose} logs --no-color tracking 2>/dev/null | tail -200; ${compose} down -v --remove-orphans >/dev/null 2>&1; exit $code`,
        30 * 60_000,
        onOutput
      );
      steps.push(step);
    } else {
      steps.push({ name: "integration tests (docker compose)", ok: true, skipped: true, output: "docker unavailable on this host; Jenkins will run them", durationMs: 0 });
    }
  }

  const ok = steps.every((s) => s.ok);
  const summary = steps
    .map((s) => `- ${s.name}: ${s.skipped ? "skipped" : s.ok ? "passed" : "FAILED"} (${Math.round(s.durationMs / 1000)}s)`)
    .join("\n");
  return { ok, steps, summary: summary || "- no checks applicable" };
};

export const failureDetails = (report: ValidationReport): string =>
  report.steps
    .filter((s) => !s.ok)
    .map((s) => `### ${s.name}\n\`\`\`\n${truncate(s.output, 12_000)}\n\`\`\``)
    .join("\n\n");

export const fileExists = (rel: string): boolean => fs.existsSync(path.join(config.workspace.repoDir, rel));
