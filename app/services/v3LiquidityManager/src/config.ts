export interface EmailConfig {
  apiKey: string;
  from: string;
  to: string[];
}

export interface AccountConfig {
  /** corporate account address (read identity via X-Wallet-Address) */
  account: string;
  /** pools this account's ladders live in */
  pools: string[];
}

export interface Config {
  apiBase: string;
  accounts: AccountConfig[];
  /** ε as a multiple of the innermost layer's half-width (used unless EPSILON_ABS_PCT is set) */
  epsilonFactor: number;
  /** absolute ε override, in percent (e.g. 1.5 = alert at ±1.5% drift) */
  epsilonAbsPct?: number;
  /** pool price vs oracle divergence that raises a dislocation warning, in percent */
  dislocationPct: number;
  pollIntervalSeconds: number;
  alertCooldownHours: number;
  healthPort: number;
  stateFile: string;
  /** canonical --widths per pool for the reposition command in alerts (else widths are
   *  reconstructed from chain, which drifts wider by up to one tick-spacing per cycle) */
  ladderWidths: Record<string, string>;
  email?: EmailConfig;
  slackWebhookUrl?: string;
}

const required = (name: string): string => {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

const num = (name: string, dflt: number): number => {
  const v = (process.env[name] || "").trim();
  if (!v) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number (got "${v}")`);
  return n;
};

const ADDR = /^[0-9a-f]{40}$/;
const normalize = (a: string) => a.trim().toLowerCase().replace(/^0x/, "");

export function loadConfig(): Config {
  const nodeUrl = required("NODE_URL").replace(/\/+$/, "");
  const apiBase = nodeUrl.endsWith("/api") ? nodeUrl : `${nodeUrl}/api`;

  // ACCOUNT_POOLS="<account>=<pool>,<pool>; <account2>=<pool>"
  const accounts: AccountConfig[] = [];
  for (const entry of required("ACCOUNT_POOLS").split(";")) {
    if (!entry.trim()) continue;
    const [addr, poolsStr] = entry.split("=").map((s) => s.trim());
    if (!addr || !poolsStr)
      throw new Error(`ACCOUNT_POOLS entry "${entry.trim()}" must be <account>=<pool>,<pool>`);
    const account = normalize(addr);
    if (!ADDR.test(account)) throw new Error(`ACCOUNT_POOLS: "${addr}" is not a valid address`);
    const pools = poolsStr.split(",").map(normalize).filter(Boolean);
    if (pools.length === 0) throw new Error(`ACCOUNT_POOLS: account ${addr} lists no pools`);
    const bad = pools.find((p) => !ADDR.test(p));
    if (bad) throw new Error(`ACCOUNT_POOLS: "${bad}" is not a valid pool address`);
    accounts.push({ account, pools });
  }
  if (accounts.length === 0) throw new Error("ACCOUNT_POOLS is empty");

  const email: EmailConfig | undefined = process.env.SENDGRID_API_KEY
    ? {
        apiKey: required("SENDGRID_API_KEY"),
        from: required("ALERT_EMAIL_FROM"),
        to: required("ALERT_EMAIL_TO").split(",").map((e) => e.trim()).filter(Boolean),
      }
    : undefined;

  // LADDER_WIDTHS="<pool>=1.5,4,10,20,40; <pool2>=1,3,7,15,35"
  const ladderWidths: Record<string, string> = {};
  for (const entry of (process.env.LADDER_WIDTHS || "").split(";")) {
    const [addr, widths] = entry.split("=").map((s) => s.trim());
    if (!addr || !widths) continue;
    const key = addr.toLowerCase().replace(/^0x/, "");
    if (widths.split(",").some((w) => !(Number(w) > 0 && Number(w) < 100)))
      throw new Error(`LADDER_WIDTHS for ${addr} must be comma-separated percentages in (0, 100)`);
    ladderWidths[key] = widths;
  }

  const cfg: Config = {
    apiBase,
    accounts,
    epsilonFactor: num("EPSILON_FACTOR", 0.75),
    epsilonAbsPct: process.env.EPSILON_ABS_PCT ? num("EPSILON_ABS_PCT", 0) : undefined,
    dislocationPct: num("DISLOCATION_PCT", 3),
    pollIntervalSeconds: num("POLL_INTERVAL_SECONDS", 300),
    alertCooldownHours: num("ALERT_COOLDOWN_HOURS", 6),
    healthPort: num("HEALTH_PORT", 3007),
    stateFile: (process.env.STATE_FILE || `${__dirname}/../.state.json`).trim(),
    ladderWidths,
    email,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL?.trim() || undefined,
  };

  if (!cfg.email && !cfg.slackWebhookUrl) {
    console.warn("[config] no notification channel configured (SENDGRID_API_KEY / SLACK_WEBHOOK_URL) — alerts will only be logged");
  }
  return cfg;
}
