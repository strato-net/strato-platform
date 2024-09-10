import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";

dotenv.config({ path: "../../../.env" });
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail(to, subject, htmlContent) {

  const msg = {
    to: to,
    from: { email: "no_reply@blockapps.net", name: "BlockApps.net" },
    subject: subject,
    html: htmlContent,
  };
  
  if (to !== "sales@blockapps.net") {
    msg.bcc = "sales@blockapps.net";
  }

  try {
    await sgMail.send(msg);
    console.log("Email sent successfully!");
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

export default sendEmail;