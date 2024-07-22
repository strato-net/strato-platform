import dotenv from "dotenv";
dotenv.config({ path: "../../../.env" });

async function sendEmail(to, subject, htmlContent, token) {
  const endpointUrl = process.env.NOTIFICATION_SERVER_URL;

  if (!endpointUrl) {
    throw new Error("Notification server URL is not set");
  }

  const payload = {
    usernames: [to],
    message: {
      subject: subject,
      htmlContent: htmlContent
    }
  };

  try {
    const response = await fetch(`${endpointUrl}/api/notify?method=email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`);
    }
    console.log("Email sent successfully!");
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

export default sendEmail;