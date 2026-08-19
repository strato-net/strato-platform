import fs from "fs";
import path from "path";
import { config } from "../config";
import { log } from "../log";
import { runShell, ShellResult } from "../agent/tools";

// All git operations the bot performs on its clone of strato-platform. The
// agent never runs these itself (its bash tool refuses them).

const repoDir = config.workspace.repoDir;
// GIT_REMOTE_URL overrides the GitHub URL (local testing against a path/bare repo)
const remoteUrl = process.env.GIT_REMOTE_URL ?? `https://github.com/${config.github.owner}/${config.github.repo}.git`;

const askpassPath = (): string => {
  const file = path.join(config.workspace.dir, "git-askpass.sh");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(config.workspace.dir, { recursive: true });
    fs.writeFileSync(
      file,
      `#!/bin/sh\ncase "$1" in\n  Username*) echo "x-access-token";;\n  *) echo "$GIT_TOKEN";;\nesac\n`,
      { mode: 0o700 }
    );
  }
  return file;
};

const gitEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: path.join(config.workspace.dir, "home"),
  LANG: "C.UTF-8",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: askpassPath(),
  GIT_TOKEN: config.github.token,
  GIT_AUTHOR_NAME: config.workspace.gitAuthorName,
  GIT_AUTHOR_EMAIL: config.workspace.gitAuthorEmail,
  GIT_COMMITTER_NAME: config.workspace.gitAuthorName,
  GIT_COMMITTER_EMAIL: config.workspace.gitAuthorEmail,
});

export class GitError extends Error {
  constructor(message: string, readonly result?: ShellResult) {
    super(message);
  }
}

export const git = async (args: string, options: { cwd?: string; timeoutMs?: number; allowFailure?: boolean } = {}): Promise<ShellResult> => {
  const result = await runShell(`git ${args}`, {
    cwd: options.cwd ?? repoDir,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
    env: gitEnv(),
  });
  if (result.code !== 0 && !options.allowFailure) {
    throw new GitError(`git ${args} failed (${result.code}): ${(result.stderr || result.stdout).trim().slice(-2000)}`, result);
  }
  return result;
};

const isRepo = (): boolean => fs.existsSync(path.join(repoDir, ".git"));

// Partial clone (blobs on demand): the repo is large and the bot only reads a
// small corner of it. Idempotent.
export const ensureRepo = async (): Promise<void> => {
  fs.mkdirSync(config.workspace.dir, { recursive: true });
  fs.mkdirSync(path.join(config.workspace.dir, "home"), { recursive: true });
  if (!isRepo()) {
    log.info("Git", `Cloning ${config.github.owner}/${config.github.repo} into ${repoDir} (partial clone)`);
    await runShell(`git clone --filter=blob:none --branch ${config.github.baseBranch} ${remoteUrl} ${JSON.stringify(repoDir)}`, {
      cwd: config.workspace.dir,
      timeoutMs: 30 * 60 * 1000,
      env: gitEnv(),
    }).then((r) => {
      if (r.code !== 0) throw new GitError(`clone failed: ${r.stderr.slice(-2000)}`, r);
    });
  }
  await git(`config user.name ${JSON.stringify(config.workspace.gitAuthorName)}`);
  await git(`config user.email ${JSON.stringify(config.workspace.gitAuthorEmail)}`);
  await git(`remote set-url origin ${remoteUrl}`);
  log.info("Git", "Repository ready");
};

export const fetchOrigin = async (): Promise<void> => {
  await git("fetch --prune origin", { timeoutMs: 15 * 60 * 1000 });
};

export const remoteBranchExists = async (branch: string): Promise<boolean> => {
  const result = await git(`ls-remote --heads origin ${JSON.stringify(branch)}`);
  return result.stdout.trim().length > 0;
};

// Discard every local change (tracked + untracked, keeps ignored files such
// as node_modules) and put the working tree on the given branch: continuing
// the remote branch when it exists (follow-up work), else fresh from base.
export const prepareBranch = async (branch: string): Promise<{ resumed: boolean; baseSha: string }> => {
  await git("reset --hard --quiet", { allowFailure: true });
  await git("clean -fd --quiet", { allowFailure: true });
  await fetchOrigin();
  const resumed = await remoteBranchExists(branch);
  const start = resumed ? `origin/${branch}` : `origin/${config.github.baseBranch}`;
  await git(`checkout -B ${JSON.stringify(branch)} ${JSON.stringify(start)} --quiet`);
  const baseSha = (await git(`rev-parse ${JSON.stringify(start)}`)).stdout.trim();
  return { resumed, baseSha };
};

export const headSha = async (): Promise<string> => (await git("rev-parse HEAD")).stdout.trim();

export const mergeBase = async (): Promise<string> =>
  (await git(`merge-base HEAD origin/${config.github.baseBranch}`)).stdout.trim();

// Working tree changes (staged, unstaged, untracked), repo-relative
export const changedFiles = async (): Promise<string[]> => {
  const result = await git("status --porcelain=v1 --untracked-files=all");
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const file = line.slice(3).trim();
      // renames: "R  old -> new"
      const arrow = file.indexOf(" -> ");
      return arrow === -1 ? file : file.slice(arrow + 4);
    })
    .map((f) => f.replace(/^"|"$/g, ""));
};

// Files changed on the branch relative to the base branch (committed), plus
// anything currently in the working tree.
export const branchChangedFiles = async (): Promise<string[]> => {
  const base = await mergeBase();
  const committed = (await git(`diff --name-only ${base}..HEAD`)).stdout.split("\n").filter(Boolean);
  const working = await changedFiles();
  return [...new Set([...committed, ...working])];
};

export const diffText = async (options: { staged?: boolean; maxChars?: number } = {}): Promise<string> => {
  const base = await mergeBase();
  const committed = (await git(`diff ${base}..HEAD`)).stdout;
  const working = (await git("diff HEAD", { allowFailure: true })).stdout;
  const untracked = (await git("ls-files --others --exclude-standard")).stdout.split("\n").filter(Boolean);
  let text = committed + working;
  for (const file of untracked) {
    const abs = path.join(repoDir, file);
    try {
      const content = fs.readFileSync(abs, "utf8");
      text += `\n--- /dev/null\n+++ b/${file}\n` + content.split("\n").map((l) => `+${l}`).join("\n") + "\n";
    } catch {
      /* binary or unreadable */
    }
  }
  const max = options.maxChars ?? 120_000;
  return text.length > max ? text.slice(0, max) + `\n... [diff truncated, ${text.length - max} more chars]` : text;
};

export const diffStat = async (): Promise<string> => {
  const base = await mergeBase();
  await git("add -A --intent-to-add", { allowFailure: true });
  const stat = (await git(`diff --stat ${base}`)).stdout;
  return stat.trim();
};

// Regenerate BUILD_METADATA the way `make` does (VERSION + content hashes) so
// the bot's commits follow the repo convention of committing it.
export const regenerateBuildMetadata = async (): Promise<void> => {
  const result = await runShell("make generate-version-file", { cwd: repoDir, timeoutMs: 120_000, env: gitEnv() });
  if (result.code !== 0) {
    log.warn("Git", `make generate-version-file failed; leaving BUILD_METADATA untouched: ${(result.stderr || result.stdout).slice(-500)}`);
  }
};

export const commitAll = async (message: string): Promise<string | null> => {
  await git("add -A");
  const staged = (await git("diff --cached --name-only")).stdout.trim();
  if (!staged) return null;
  // Multi-line messages go through a file: shell quoting would keep "\n" literal
  const messageFile = path.join(config.workspace.dir, "commit-message.txt");
  fs.writeFileSync(messageFile, message.endsWith("\n") ? message : message + "\n");
  await git(`commit --quiet -F ${JSON.stringify(messageFile)}`);
  return headSha();
};

export const push = async (branch: string): Promise<void> => {
  if (config.dryRun) {
    log.info("Git", `[dry-run] git push origin ${branch}`);
    return;
  }
  await git(`push -u origin ${JSON.stringify(branch)}`, { timeoutMs: 15 * 60 * 1000 });
};

export const recentLog = async (n = 5): Promise<string> => (await git(`log --oneline -${n}`)).stdout.trim();
