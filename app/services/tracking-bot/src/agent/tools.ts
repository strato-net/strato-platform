import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { config } from "../config";
import { JsonSchema, ToolDefinition, ToolExecutor, ToolResult } from "../llm/types";
import { matchesAny, resolveInside } from "../workspace/paths";

const MAX_OUTPUT_CHARS = 24_000;
const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".docker-work", "build", ".stack-work", "coverage"]);

export const truncate = (text: string, max = MAX_OUTPUT_CHARS): string => {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.6));
  const tail = text.slice(-Math.floor(max * 0.4));
  return `${head}\n\n... [${text.length - max} chars truncated] ...\n\n${tail}`;
};

// Environment handed to agent-run shells: no bot secrets, a private HOME so
// npm/git caches live inside the workspace.
export const sandboxEnv = (): NodeJS.ProcessEnv => {
  const home = path.join(config.workspace.dir, "home");
  fs.mkdirSync(home, { recursive: true });
  return {
    PATH: process.env.PATH,
    HOME: home,
    LANG: process.env.LANG ?? "C.UTF-8",
    TERM: "dumb",
    TZ: "UTC",
    CI: "true",
    GIT_TERMINAL_PROMPT: "0",
    NODE_ENV: "development",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
    DOCKER_HOST: process.env.DOCKER_HOST,
    DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
    // Docker CLI contexts/credentials live under the real HOME (Docker Desktop
    // on macOS needs them); HOME itself stays private to the sandbox
    DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? (fs.existsSync(path.join(os.homedir(), ".docker")) ? path.join(os.homedir(), ".docker") : undefined),
    DOCKER_BUILDKIT: "1",
  };
};

export interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export const runShell = (
  command: string,
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv; onOutput?: (chunk: string) => void }
): Promise<ShellResult> =>
  new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: options.cwd,
      env: options.env ?? sandboxEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      options.onOutput?.(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      options.onOutput?.(s);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(error), timedOut });
    });
  });

// Branch/commit/push are the bot's job; the agent edits files and runs builds/tests.
const FORBIDDEN_COMMANDS = [
  /\bgit\s+(push|checkout|switch|reset|rebase|merge|commit|stash|clean|branch\s+-[dD]|tag|remote|fetch|pull|cherry-pick|am|apply)\b/,
  /\brm\s+-rf\s+(\/|~|\.\.|\$HOME)(\s|$)/,
  /\bdocker\s+(system\s+prune|volume\s+prune|rm\s+-f\s+\$\(docker\s+ps)/,
  /\b(sudo|su)\b/,
  /\bcurl\b[^|]*\|\s*(ba)?sh\b/,
];

const schemas = {
  bash: {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command, run from the repository root" },
      timeout_seconds: { type: "number", description: "Kill after this many seconds (default 600, max 1800)" },
    },
    required: ["command"],
    additionalProperties: false,
  } as JsonSchema,
  read_file: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository-relative path" },
      offset: { type: "number", description: "1-based first line to return (default 1)" },
      limit: { type: "number", description: "Max lines to return (default 400)" },
    },
    required: ["path"],
    additionalProperties: false,
  } as JsonSchema,
  write_file: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository-relative path (created if missing)" },
      content: { type: "string", description: "Full file content" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  } as JsonSchema,
  edit_file: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository-relative path" },
      old_string: { type: "string", description: "Exact text to replace (must be unique unless replace_all)" },
      new_string: { type: "string", description: "Replacement text" },
      replace_all: { type: "boolean", description: "Replace every occurrence (default false)" },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  } as JsonSchema,
  list_files: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to list (default: app/services/tracking)" },
      depth: { type: "number", description: "Max depth (default 3)" },
    },
    additionalProperties: false,
  } as JsonSchema,
  search: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Extended regex (grep -E)" },
      path: { type: "string", description: "Directory or file to search (default: app/services/tracking)" },
      glob: { type: "string", description: "Only files matching this name pattern, e.g. *.ts" },
      case_insensitive: { type: "boolean" },
    },
    required: ["pattern"],
    additionalProperties: false,
  } as JsonSchema,
};

const readOnlyDefinitions: ToolDefinition[] = [
  { name: "read_file", description: "Read a file from the repository with line numbers.", inputSchema: schemas.read_file },
  { name: "list_files", description: "List files under a directory (node_modules/dist/.git excluded).", inputSchema: schemas.list_files },
  { name: "search", description: "Search file contents with grep -E and return matching lines with paths and line numbers.", inputSchema: schemas.search },
];

const writeDefinitions: ToolDefinition[] = [
  {
    name: "bash",
    description:
      "Run a bash command from the repository root (npm, tsc, docker compose, ls, cat, git status/diff/log ...). Git branch/commit/push operations are refused: the bot commits and pushes for you. Output is truncated when long.",
    inputSchema: schemas.bash,
  },
  { name: "write_file", description: "Create or overwrite a file. Only paths inside the allowed area are accepted.", inputSchema: schemas.write_file },
  {
    name: "edit_file",
    description: "Replace an exact string in a file (whitespace-sensitive). Fails if the string is missing or ambiguous. Only paths inside the allowed area are accepted.",
    inputSchema: schemas.edit_file,
  },
];

export const readOnlyTools = (): ToolDefinition[] => [...readOnlyDefinitions];
export const fullTools = (): ToolDefinition[] => [...readOnlyDefinitions, ...writeDefinitions];

const listTree = (root: string, dir: string, depth: number, out: string[], prefix = ""): void => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    out.push(`${prefix}[unreadable: ${error instanceof Error ? error.message : error}]`);
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const rel = path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      out.push(`${rel}/`);
      if (depth > 1) listTree(root, path.join(dir, entry.name), depth - 1, out, prefix);
    } else {
      out.push(rel);
    }
    if (out.length > 2000) {
      out.push("... [listing truncated]");
      return;
    }
  }
};

export const createToolExecutor = (options: {
  repoDir: string;
  writable: boolean;
  allowedPaths: string[];
  onLog?: (line: string) => void;
}): ToolExecutor => {
  const { repoDir } = options;
  const err = (message: string): ToolResult => ({ content: message, isError: true });

  const assertWritable = (rel: string): string | null => {
    if (!options.writable) return "This session is read-only.";
    if (!matchesAny(rel, options.allowedPaths)) {
      return `Refusing to write ${rel}: only these paths may change: ${options.allowedPaths.join(", ")}`;
    }
    return null;
  };

  return async (name, input): Promise<ToolResult> => {
    try {
      return await dispatch(name, input);
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  };

  async function dispatch(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case "read_file": {
        const { abs, rel } = resolveInside(repoDir, String(input.path ?? ""));
        if (!fs.existsSync(abs)) return err(`${rel} does not exist`);
        if (fs.statSync(abs).isDirectory()) return err(`${rel} is a directory; use list_files`);
        const lines = fs.readFileSync(abs, "utf8").split("\n");
        const offset = Math.max(1, Number(input.offset ?? 1));
        const limit = Math.min(2000, Math.max(1, Number(input.limit ?? 400)));
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const body = slice.map((l, i) => `${String(offset + i).padStart(5)}| ${l}`).join("\n");
        const more = lines.length > offset - 1 + limit ? `\n... (${lines.length - (offset - 1 + limit)} more lines; total ${lines.length})` : "";
        return { content: truncate(body + more, 60_000) };
      }
      case "list_files": {
        const { abs, rel } = resolveInside(repoDir, String(input.path ?? config.workspace.servicePath));
        if (!fs.existsSync(abs)) return err(`${rel} does not exist`);
        const out: string[] = [];
        listTree(repoDir, abs, Math.min(6, Math.max(1, Number(input.depth ?? 3))), out);
        return { content: out.join("\n") || "(empty)" };
      }
      case "search": {
        const { rel } = resolveInside(repoDir, String(input.path ?? config.workspace.servicePath));
        const args = ["-rnIE", "--color=never"];
        for (const dir of IGNORED_DIRS) args.push(`--exclude-dir=${dir}`);
        if (input.case_insensitive) args.push("-i");
        if (input.glob) args.push(`--include=${String(input.glob)}`);
        args.push("-e", String(input.pattern), "--", rel || ".");
        const result = await new Promise<ShellResult>((resolve) => {
          const child = spawn("grep", args, { cwd: repoDir, env: sandboxEnv() });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (d) => (stdout += d.toString()));
          child.stderr.on("data", (d) => (stderr += d.toString()));
          child.on("close", (code) => resolve({ code, stdout, stderr, timedOut: false }));
          child.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e), timedOut: false }));
        });
        if (result.code === 1) return { content: "(no matches)" };
        if (result.code !== 0) return err(result.stderr || `grep exited ${result.code}`);
        const lines = result.stdout.split("\n").filter(Boolean);
        const shown = lines.slice(0, 300).join("\n");
        return { content: truncate(shown + (lines.length > 300 ? `\n... ${lines.length - 300} more matches` : "")) };
      }
      case "write_file": {
        const { abs, rel } = resolveInside(repoDir, String(input.path ?? ""));
        const denied = assertWritable(rel);
        if (denied) return err(denied);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(input.content ?? ""));
        options.onLog?.(`write_file ${rel} (${String(input.content ?? "").length} chars)`);
        return { content: `Wrote ${rel}` };
      }
      case "edit_file": {
        const { abs, rel } = resolveInside(repoDir, String(input.path ?? ""));
        const denied = assertWritable(rel);
        if (denied) return err(denied);
        if (!fs.existsSync(abs)) return err(`${rel} does not exist`);
        const original = fs.readFileSync(abs, "utf8");
        const oldString = String(input.old_string ?? "");
        const newString = String(input.new_string ?? "");
        if (!oldString) return err("old_string must not be empty");
        const occurrences = original.split(oldString).length - 1;
        if (occurrences === 0) return err(`old_string not found in ${rel}`);
        if (occurrences > 1 && !input.replace_all) {
          return err(`old_string occurs ${occurrences} times in ${rel}; include more context or set replace_all`);
        }
        const updated = input.replace_all ? original.split(oldString).join(newString) : original.replace(oldString, () => newString);
        fs.writeFileSync(abs, updated);
        options.onLog?.(`edit_file ${rel} (${occurrences} replacement${occurrences > 1 ? "s" : ""})`);
        return { content: `Edited ${rel}` };
      }
      case "bash": {
        if (!options.writable) return err("bash is unavailable in this read-only session");
        const command = String(input.command ?? "");
        if (!command.trim()) return err("command is empty");
        for (const forbidden of FORBIDDEN_COMMANDS) {
          if (forbidden.test(command)) return err(`Refused: this command matches a forbidden pattern (${forbidden}). Git branch/commit/push and destructive host operations are handled by the bot.`);
        }
        const timeoutMs = Math.min(1800, Math.max(1, Number(input.timeout_seconds ?? 600))) * 1000;
        options.onLog?.(`$ ${command}`);
        const result = await runShell(command, { cwd: repoDir, timeoutMs });
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n--- stderr ---\n");
        options.onLog?.(truncate(output, 4000));
        const status = result.timedOut ? `TIMED OUT after ${timeoutMs / 1000}s` : `exit code ${result.code}`;
        return { content: `${status}\n${truncate(output)}`.trim(), isError: result.timedOut || result.code !== 0 };
      }
      default:
        return err(`Unknown tool ${name}`);
    }
  }
};
