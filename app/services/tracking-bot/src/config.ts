import dotenv from "dotenv";
import path from "path";

dotenv.config();

const env = (name: string, fallback?: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback === undefined) throw new Error(`Missing required env ${name}`);
    return fallback;
  }
  return value;
};

const optional = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

const list = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const bool = (name: string, fallback: boolean): boolean => {
  const value = optional(name);
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const num = (name: string, fallback: number): number => {
  const value = optional(name);
  return value === undefined ? fallback : Number(value);
};

// Model spec: "<provider>:<model>", e.g. anthropic:claude-opus-5,
// openai:gpt-5.2-codex, xai:grok-4, openai-compatible:<model>
export interface ModelSpec {
  provider: "anthropic" | "openai" | "xai" | "openai-compatible";
  model: string;
}

export const parseModelSpec = (raw: string): ModelSpec => {
  const idx = raw.indexOf(":");
  if (idx === -1) throw new Error(`Model spec "${raw}" must be <provider>:<model>`);
  const provider = raw.slice(0, idx) as ModelSpec["provider"];
  const model = raw.slice(idx + 1);
  if (!["anthropic", "openai", "xai", "openai-compatible"].includes(provider)) {
    throw new Error(`Unknown model provider "${provider}" in "${raw}"`);
  }
  if (!model) throw new Error(`Model spec "${raw}" has no model name`);
  return { provider, model };
};

const workspaceDir = path.resolve(env("WORKSPACE_DIR", "/var/lib/tracking-bot"));

// Without a GitHub token the bot can still read the public repo anonymously
// (60 req/h) — useful for smoke tests — but must not attempt any write.
const githubToken = optional("GITHUB_TOKEN");

export const config = {
  dryRun: bool("DRY_RUN", false) || !githubToken,
  pollIntervalMs: num("POLL_INTERVAL_SECONDS", 60) * 1000,
  port: num("PORT", 3020),

  github: {
    token: githubToken ?? "",
    owner: env("GITHUB_OWNER", "strato-net"),
    repo: env("GITHUB_REPO", "strato-platform"),
    // Login of the bot account (auto-detected from the token when unset)
    botLogin: optional("GITHUB_BOT_LOGIN"),
    baseBranch: env("BASE_BRANCH", "develop"),
    branchPrefix: env("BRANCH_PREFIX", "tracking-bot/"),
    openPullRequest: bool("OPEN_PULL_REQUEST", true),
    // Team whose members may file work for the bot (org team slug), plus an
    // optional static allowlist used when the token cannot read teams
    coreTeamSlug: env("CORE_TEAM_SLUG", "core"),
    coreTeamMembers: list(optional("CORE_TEAM_MEMBERS")).map((s) => s.toLowerCase()),
    // Triage: label match and/or model classification decide relevance
    triageLabels: list(env("TRIAGE_LABELS", "tracking,tracking-server,tracking-ui")).map((s) => s.toLowerCase()),
    triageUseAi: bool("TRIAGE_USE_AI", true),
    triageSkipHumanAssigned: bool("TRIAGE_SKIP_HUMAN_ASSIGNED", true),
    // On the first poll only issues updated within this window are classified
    triageLookbackDays: num("TRIAGE_LOOKBACK_DAYS", 14),
    // Optional restriction to specific issue numbers (staged rollouts / smoke tests)
    issueAllowlist: list(optional("ISSUE_ALLOWLIST")).map(Number).filter((n) => Number.isFinite(n)),
    // Labels the bot maintains on issues it owns (created on demand)
    labelPrefix: env("BOT_LABEL_PREFIX", "tracking-bot"),
  },

  models: {
    triage: parseModelSpec(env("TRIAGE_MODEL", "anthropic:claude-opus-5")),
    implement: parseModelSpec(env("IMPLEMENT_MODEL", "anthropic:claude-opus-5")),
    effort: env("MODEL_EFFORT", "high") as "low" | "medium" | "high" | "xhigh" | "max",
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    openaiApiKey: optional("OPENAI_API_KEY"),
    xaiApiKey: optional("XAI_API_KEY"),
    xaiBaseUrl: env("XAI_BASE_URL", "https://api.x.ai/v1"),
    openaiCompatibleApiKey: optional("OPENAI_COMPAT_API_KEY"),
    openaiCompatibleBaseUrl: optional("OPENAI_COMPAT_BASE_URL"),
    maxAgentTurns: num("AGENT_MAX_TURNS", 250),
    maxFixRounds: num("AGENT_MAX_FIX_ROUNDS", 3),
    maxCiRounds: num("CI_MAX_FIX_ROUNDS", 3),
  },

  workspace: {
    dir: workspaceDir,
    repoDir: path.join(workspaceDir, "repo"),
    stateFile: path.join(workspaceDir, "state.json"),
    logsDir: path.join(workspaceDir, "logs"),
    gitAuthorName: env("GIT_AUTHOR_NAME", "STRATO Tracking Bot"),
    gitAuthorEmail: env("GIT_AUTHOR_EMAIL", "tracking-bot@blockapps.net"),
    // Globs (minimatch-style, ** and *) the bot's diff may touch
    allowedPaths: list(
      env(
        "ALLOWED_PATHS",
        "app/services/tracking/**,docker-compose.tracking.tpl.yml,BUILD_METADATA"
      )
    ),
    // At least one changed file must match one of these (integration tests)
    requiredTestPaths: list(env("REQUIRED_TEST_PATHS", "app/services/tracking/test/**")),
    // Paths whose changes exempt the diff from the test requirement (docs only)
    testExemptPaths: list(env("TEST_EXEMPT_PATHS", "**/*.md")),
    localTests: bool("LOCAL_TESTS", true),
    regenerateBuildMetadata: bool("REGENERATE_BUILD_METADATA", true),
    // Which top-level project the tests/typecheck live in
    servicePath: "app/services/tracking",
  },

  jenkins: {
    enabled: bool("JENKINS_ENABLED", true),
    url: optional("JENKINS_URL")?.replace(/\/$/, ""),
    user: optional("JENKINS_USER"),
    token: optional("JENKINS_TOKEN"),
    // Multibranch pipeline job path, e.g. "strato-platform" or "folder/job/strato-platform"
    job: optional("JENKINS_JOB"),
    requiredStages: list(env("JENKINS_REQUIRED_STAGES", "Tracking Server Tests")),
    acceptUnstable: bool("JENKINS_ACCEPT_UNSTABLE", true),
    timeoutMinutes: num("JENKINS_TIMEOUT_MINUTES", 240),
    // Kick the branch job if no build for our commit appears within this window
    triggerAfterMinutes: num("JENKINS_TRIGGER_AFTER_MINUTES", 10),
  },

  deploy: {
    enabled: bool("DEPLOY_ENABLED", true),
    host: optional("DEPLOY_SSH_HOST"),
    port: num("DEPLOY_SSH_PORT", 22),
    user: optional("DEPLOY_SSH_USER"),
    privateKey: optional("DEPLOY_SSH_KEY"), // PEM contents
    privateKeyPath: optional("DEPLOY_SSH_KEY_PATH"),
    hostKeyFingerprint: optional("DEPLOY_SSH_HOST_FINGERPRINT"), // sha256 pin (optional)
    // Optional bastion / jump host (ProxyJump); same key unless DEPLOY_SSH_PROXY_KEY* set
    proxyHost: optional("DEPLOY_SSH_PROXY_HOST"),
    proxyPort: num("DEPLOY_SSH_PROXY_PORT", 22),
    proxyUser: optional("DEPLOY_SSH_PROXY_USER"),
    proxyPrivateKey: optional("DEPLOY_SSH_PROXY_KEY"),
    proxyPrivateKeyPath: optional("DEPLOY_SSH_PROXY_KEY_PATH"),
    repoDir: optional("DEPLOY_REPO_DIR"),
    // Command that (re)starts the stack after `make` (run in repoDir), e.g. ./run-tracking.sh
    upCommand: optional("DEPLOY_UP_COMMAND"),
    composeFile: env("DEPLOY_COMPOSE_FILE", "docker-compose.tracking.yml"),
    envFile: optional("DEPLOY_ENV_FILE"),
    composeProfiles: optional("DEPLOY_COMPOSE_PROFILES"),
    makeTargets: env("DEPLOY_MAKE_TARGETS", "tracking tracking-nginx tracking-ui docker-compose"),
    healthUrl: optional("DEPLOY_HEALTH_URL"),
    // Full override: a shell command template run on the server instead of the
    // built-in script; {branch} {sha} {repoDir} are substituted
    command: optional("DEPLOY_COMMAND"),
    timeoutMinutes: num("DEPLOY_TIMEOUT_MINUTES", 40),
  },
};

export type Config = typeof config;
