import axios from "axios";
import dotenv from "dotenv";
import config from "../load.config";
import { util } from "../blockapps-rest-plus";

dotenv.config({ path: "../../../.env" });

async function sendEmail(to, subject, htmlContent) {
  const { token } = await util.getApplicationCredentials({ config });
  const reqBody = {
    usernames: [to],
    message: {
      subject:subject,
      htmlContent: htmlContent
    }
  };
  try {
    // console.log("config.nodes[0]", config.nodes[0])
    // const url = `http:/${process.env.NOTIFICATION_SERVER_URL}`
    // const url = `http://localhost:3002`
    // const url = `http://172.17.0.1:8080`
    const url = config.nodes[0];
    const response = await axios.post(`${url}/notify`, reqBody, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    console.log("Email sent successfully to ", response.data);
    if (response.status === 200 || response.status === 201) {
      console.log("Email sent successfully");
    }

  } catch (error) {
    console.log("Failed to send email");
    console.log("error", error);
  }
}

export default sendEmail;
