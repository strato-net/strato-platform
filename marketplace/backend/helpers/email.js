import axios from "axios";
import dotenv from "dotenv";
import config from "../load.config";
import { util } from "../blockapps-rest-plus";

dotenv.config({ path: "../../../.env" });

async function sendEmail(to, subject, htmlContent) {

  const msg = {
    to: to,
    from: { email: "no_reply@blockapps.net", name: "David Nallapu.net" },
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
  }
}

export default sendEmail;
