const {
  handleCertificateRegistered,
} = require("./handleCertificateRegistered");

async function handleMessage(message) {
  const messageData = message.data.toString();
  console.log("Received message:", messageData);

  if (messageData === "pong") {
    // Handle the pong message
    console.log("Received pong message");
    return;
  }

  try {
    const event = JSON.parse(messageData);
    if (event?.eventEvent?.eventName === "CertificateRegistered") {
      await handleCertificateRegistered(event);
      // Handle successful event processing
      console.log("Successfully processed CertificateRegistered event");
    }
  } catch (error) {
    console.error("Failed to process message:", messageData, error);
  }
}

module.exports = { handleMessage };
