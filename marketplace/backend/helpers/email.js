import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config({ path: "../../../.env" });

/**
 * Signs a message hash using an external signature service.
 * @param {string} msgHash - The hash of the message to be signed.
 * @param {string} token - The authorization token for the signature service.
 * @returns {Object} - The signature data.
 */
async function signMessage(msgHash, token) {
  try {
    const response = await fetch(
      `https://workspace-ariya-0exm82f.blockapps.net/strato/v2.3/signature`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ msgHash }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to sign message: ${response.statusText}`);
    }

    const signatureData = await response.json();
    console.log("signature123: ", signatureData);
    return signatureData;
  } catch (error) {
    console.error("Error signing message: ", error);
    throw error;
  }
}

/**
 * Sends an email notification.
 * @param {string} to - The recipient's email address.
 * @param {string} subject - The subject of the email.
 * @param {string} htmlContent - The HTML content of the email.
 * @param {string} token - The authorization token for the notification service.
 * @throws Will throw an error if the notification server URL is not set or if the email fails to send.
 */
async function sendEmail(to, subject, htmlContent, token) {
  const endpointUrl = process.env.NOTIFICATION_SERVER_URL;

  if (!endpointUrl) {
    throw new Error("Notification server URL is not set");
  }

  // Get the current timestamp
  const timestamp = new Date().toISOString();

  // Concatenate the subject, htmlContent, and timestamp
  const dataToHash = subject + htmlContent + timestamp;

  // Hash the concatenated string
  const msgHash = crypto.createHash("sha256").update(dataToHash).digest("hex");

  // Log the hash and the timestamp (for debugging purposes)
  console.log(`Hash: ${msgHash}`);
  console.log(`Timestamp: ${timestamp}`);

  // Sign the message hash
  const signature = await signMessage(msgHash, token);

  // Create the payload for the email notification
  const payload = {
    usernames: [to],
    message: {
      subject,
      htmlContent,
    },
    signature,
    timestamp,
    msgHash,
  };

  try {
    const response = await fetch(`${endpointUrl}/notify?method=email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.statusText}`);
    }

    console.log("Email sent successfully!");
  } catch (error) {
    console.error("Error sending email: ", error);
    throw error;
  }
}

export default sendEmail;
