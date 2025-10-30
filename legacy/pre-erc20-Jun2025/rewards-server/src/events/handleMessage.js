const {
  handleCertificateRegistered,
} = require("./handleCertificateRegistered");
const { handleOrderRewards } = require("./orderHandler");

async function handleMessage(messageData, token) {
  console.log("Received message:", messageData);

  try {
    const event = JSON.parse(messageData);
    switch (event?.eventEvent?.eventName) {
      case "CertificateRegistered":
        await handleCertificateRegistered(event, token);
        break;

      case "Order":
        await handleOrderRewards(event, token); // TODO: THIS WILL NOT WORK WITH NEW USDST REWARDS
        break;

      default:
        console.warn(`Unhandled event type: ${event?.eventEvent?.eventName}`);
    }
  } catch (error) {
    console.error("Failed to process message:", messageData, error);
  }
}

module.exports = { handleMessage };
