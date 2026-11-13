import axios from "axios";

const apiKey = process.env.SENDGRID_API_KEY;

const METALS_INQUIRY_TO = "metals@strato.nexus";
const METALS_INQUIRY_FROM = "no-reply@strato.nexus";

/** Fields for a physical-metals inquiry email (other contact types can use their own types here later). */
export interface MetalsInquiryPayload {
  name: string;
  email: string;
  message: string;
}

export async function sendMetalsInquiry(data: MetalsInquiryPayload): Promise<void> {
  if (!apiKey) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }

  const text = [
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    "",
    "Message:",
    data.message,
  ].join("\n");
  const html = [
    `<h2>New Metals Inquiry</h2>`,
    `<p><strong>Name:</strong> ${escapeHtml(data.name)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(data.email)}</p>`,
    `<hr/>`,
    `<p>${escapeHtml(data.message).replace(/\n/g, "<br/>")}</p>`,
  ].join("\n");

  await axios.post(
    "https://api.sendgrid.com/v3/mail/send",
    {
      personalizations: [{ to: [{ email: METALS_INQUIRY_TO }] }],
      from: { email: METALS_INQUIRY_FROM },
      reply_to: { email: data.email },
      subject: `New Metals Inquiry from ${data.name}`,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    },
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
