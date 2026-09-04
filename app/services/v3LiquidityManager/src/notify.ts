import axios from "axios";
import { Config } from "./config";

const log = (msg: string) => console.log(`${new Date().toISOString()} [notify] ${msg}`);

/** Fan a message out to every configured channel; failures are logged, never thrown. */
export async function notify(cfg: Config, subject: string, body: string): Promise<void> {
  log(`${subject}\n${body}`);

  if (cfg.email) {
    try {
      await axios.post(
        "https://api.sendgrid.com/v3/mail/send",
        {
          personalizations: [{ to: cfg.email.to.map((email) => ({ email })) }],
          from: { email: cfg.email.from },
          subject,
          content: [{ type: "text/plain", value: body }],
        },
        { headers: { Authorization: `Bearer ${cfg.email.apiKey}` } }
      );
      log(`email accepted by SendGrid for ${cfg.email.to.join(", ")} (202 = queued, not proof of delivery)`);
    } catch (err: any) {
      log(`email failed: ${err.response ? JSON.stringify(err.response.data) : err.message}`);
    }
  }

  if (cfg.slackWebhookUrl) {
    try {
      await axios.post(cfg.slackWebhookUrl, { text: `*${subject}*\n${body}` });
      log("slack sent");
    } catch (err: any) {
      log(`slack failed: ${err.response ? JSON.stringify(err.response.data) : err.message}`);
    }
  }
}
