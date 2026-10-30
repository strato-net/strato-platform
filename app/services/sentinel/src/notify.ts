import axios from "axios";
import { Config, SEVERITY_ICON } from "./config";
import { Alert } from "./rules";

const log = (msg: string) => console.log(`${new Date().toISOString()} [notify] ${msg}`);

/** Slack caps a message at 40k chars; keep each post readable */
const MAX_ALERTS = 20;
const MAX_VALUE = 500;

const format = (a: Alert): string => {
  const fields = Object.entries(a.fields).map(([k, v]) => {
    const s = String(v);
    return `• ${k}: \`${s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s}\``;
  });
  return `${SEVERITY_ICON[a.severity]} *${a.title}*\n${fields.join("\n")}`;
};

async function post(token: string, channel: string, alerts: Alert[]): Promise<void> {
  const shown = alerts.slice(0, MAX_ALERTS).map(format);
  if (alerts.length > MAX_ALERTS) shown.push(`…and ${alerts.length - MAX_ALERTS} more (see service logs)`);
  const { data } = await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, text: shown.join("\n\n") },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  // the Slack Web API answers HTTP 200 even on failure — the body's ok field is the verdict
  if (!data.ok) throw new Error(data.error || "unknown Slack error");
}

/** Critical/high go to the main channel, info to the info channel (log-only if unset).
 *  Throws on delivery failure so the caller keeps its cursor and retries. */
export async function notify(cfg: Config, alerts: Alert[]): Promise<void> {
  if (alerts.length === 0) return;
  for (const a of alerts) log(format(a).replace(/\n/g, " "));
  if (!cfg.slack) return;

  const urgent = alerts.filter((a) => a.severity !== "info");
  const info = alerts.filter((a) => a.severity === "info");
  if (urgent.length) await post(cfg.slack.token, cfg.slack.channelId, urgent);
  if (info.length && cfg.slack.infoChannelId) await post(cfg.slack.token, cfg.slack.infoChannelId, info);
}
