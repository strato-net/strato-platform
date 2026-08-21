import crypto from "crypto";
import fs from "fs";
import { Client, ConnectConfig } from "ssh2";
import { config } from "../config";
import { log } from "../log";
import { REMOTE_DEPLOY_SCRIPT } from "./script";

export interface DeployResult {
  ok: boolean;
  rolledBack: boolean;
  exitCode: number | null;
  output: string;
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const privateKey = (): string => {
  if (config.deploy.privateKey) return config.deploy.privateKey.replace(/\\n/g, "\n");
  if (config.deploy.privateKeyPath) return fs.readFileSync(config.deploy.privateKeyPath, "utf8");
  throw new Error("DEPLOY_SSH_KEY or DEPLOY_SSH_KEY_PATH is required");
};

const proxyPrivateKey = (): string => {
  if (config.deploy.proxyPrivateKey) return config.deploy.proxyPrivateKey.replace(/\\n/g, "\n");
  if (config.deploy.proxyPrivateKeyPath) return fs.readFileSync(config.deploy.proxyPrivateKeyPath, "utf8");
  return privateKey();
};

const hostVerifier = (): ConnectConfig["hostVerifier"] | undefined => {
  if (!config.deploy.hostKeyFingerprint) return undefined;
  const expected = config.deploy.hostKeyFingerprint.replace(/^SHA256:/, "").replace(/=+$/, "");
  return (key: Buffer) => {
    const actual = crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
    if (actual !== expected) {
      log.error("Deploy", `SSH host key mismatch: got SHA256:${actual}, expected SHA256:${expected}`);
      return false;
    }
    return true;
  };
};

const connectClient = (settings: ConnectConfig): Promise<Client> =>
  new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client));
    client.on("error", reject);
    client.connect({ readyTimeout: 30_000, keepaliveInterval: 15_000, ...settings });
  });

// Direct connection, or via the bastion (ProxyJump): open a TCP forward from
// the bastion to the target and run the second SSH session over that stream.
const connect = async (): Promise<{ client: Client; close: () => void }> => {
  const target: ConnectConfig = {
    host: config.deploy.host,
    port: config.deploy.port,
    username: config.deploy.user,
    privateKey: privateKey(),
    hostVerifier: hostVerifier(),
  };
  if (!config.deploy.proxyHost) {
    const client = await connectClient(target);
    return { client, close: () => client.end() };
  }
  const bastion = await connectClient({
    host: config.deploy.proxyHost,
    port: config.deploy.proxyPort,
    username: config.deploy.proxyUser ?? config.deploy.user,
    privateKey: proxyPrivateKey(),
  });
  const stream = await new Promise<NodeJS.ReadWriteStream>((resolve, reject) => {
    bastion.forwardOut("127.0.0.1", 0, config.deploy.host!, config.deploy.port, (error, channel) => {
      if (error) return reject(error);
      resolve(channel as unknown as NodeJS.ReadWriteStream);
    });
  }).catch((error) => {
    bastion.end();
    throw error;
  });
  try {
    const client = await connectClient({ ...target, sock: stream as any });
    return {
      client,
      close: () => {
        client.end();
        bastion.end();
      },
    };
  } catch (error) {
    bastion.end();
    throw error;
  }
};

const exec = (
  client: Client,
  command: string,
  options: { stdin?: string; timeoutMs: number; onOutput?: (chunk: string) => void }
): Promise<{ code: number | null; output: string }> =>
  new Promise((resolve, reject) => {
    client.exec(command, { pty: false }, (error, stream) => {
      if (error) return reject(error);
      let output = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stream.close();
        resolve({ code: null, output: output + "\n[timed out]" });
      }, options.timeoutMs);
      const push = (chunk: Buffer) => {
        const s = chunk.toString();
        output += s;
        options.onOutput?.(s);
      };
      stream.on("data", push);
      stream.stderr.on("data", push);
      stream.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, output });
      });
      if (options.stdin !== undefined) {
        stream.end(options.stdin);
      }
    });
  });

// Upload the deploy script, run it, stream output back. Never throws for a
// failed deploy (that is a result); throws only for connection problems.
export const deployToTrackingServer = async (
  branch: string,
  sha: string,
  onOutput?: (chunk: string) => void
): Promise<DeployResult> => {
  if (!config.deploy.host || !config.deploy.user || !config.deploy.repoDir) {
    throw new Error("DEPLOY_SSH_HOST, DEPLOY_SSH_USER and DEPLOY_REPO_DIR are required");
  }
  if (config.dryRun) {
    log.info("Deploy", `[dry-run] would deploy ${branch}@${sha} to ${config.deploy.host}`);
    return { ok: true, rolledBack: false, exitCode: 0, output: "[dry-run]" };
  }
  const { client, close } = await connect();
  try {
    const remotePath = `/tmp/tracking-bot-deploy-${sha.slice(0, 12)}.sh`;
    const upload = await exec(client, `cat > ${remotePath} && chmod 700 ${remotePath}`, {
      stdin: REMOTE_DEPLOY_SCRIPT,
      timeoutMs: 60_000,
    });
    if (upload.code !== 0) {
      return { ok: false, rolledBack: false, exitCode: upload.code, output: `script upload failed: ${upload.output}` };
    }
    const command = config.deploy.command
      ? config.deploy.command.replace(/\{branch\}/g, branch).replace(/\{sha\}/g, sha).replace(/\{repoDir\}/g, config.deploy.repoDir)
      : [
          "bash",
          remotePath,
          shellQuote(config.deploy.repoDir),
          shellQuote(branch),
          shellQuote(sha),
          shellQuote(config.deploy.composeFile),
          shellQuote(config.deploy.makeTargets),
          shellQuote(config.deploy.healthUrl ?? ""),
          shellQuote(config.deploy.envFile ?? ""),
          shellQuote(config.deploy.composeProfiles ?? ""),
          shellQuote(config.deploy.upCommand ?? ""),
        ].join(" ");
    log.info("Deploy", `running on ${config.deploy.host}: ${command}`);
    const run = await exec(client, command, { timeoutMs: config.deploy.timeoutMinutes * 60_000, onOutput });
    await exec(client, `rm -f ${remotePath}`, { timeoutMs: 10_000 }).catch(() => undefined);
    const rolledBack = run.output.includes("DEPLOY_ROLLED_BACK");
    return { ok: run.code === 0 && run.output.includes("DEPLOY_OK"), rolledBack, exitCode: run.code, output: run.output };
  } finally {
    close();
  }
};

export const isDeployConfigured = (): boolean =>
  config.deploy.enabled && Boolean(config.deploy.host && config.deploy.user && config.deploy.repoDir && (config.deploy.privateKey || config.deploy.privateKeyPath));

// Connectivity probe (bastion hop + key + repo dir), used by scripts/sshCheck
export const sshCheck = async (): Promise<string> => {
  const { client, close } = await connect();
  try {
    const result = await exec(
      client,
      `hostname; whoami; cd ${shellQuote(config.deploy.repoDir ?? ".")} && git rev-parse --abbrev-ref HEAD && git log --oneline -1 && docker compose version && test -x ./run-tracking.sh && echo run-tracking.sh:ok`,
      { timeoutMs: 60_000 }
    );
    return `exit ${result.code}\n${result.output}`;
  } finally {
    close();
  }
};
