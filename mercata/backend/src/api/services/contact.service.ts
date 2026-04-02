import sgMail, { MailDataRequired } from "@sendgrid/mail";

const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

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

  const msg: MailDataRequired = {
    to: METALS_INQUIRY_TO,
    from: METALS_INQUIRY_FROM,
    replyTo: data.email,
    subject: `New Metals Inquiry from ${data.name}`,
    text: [
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      "",
      "Message:",
      data.message,
    ].join("\n"),
    html: [
      `<h2>New Metals Inquiry</h2>`,
      `<p><strong>Name:</strong> ${escapeHtml(data.name)}</p>`,
      `<p><strong>Email:</strong> ${escapeHtml(data.email)}</p>`,
      `<hr/>`,
      `<p>${escapeHtml(data.message).replace(/\n/g, "<br/>")}</p>`,
    ].join("\n"),
  };

  await sgMail.send(msg);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
