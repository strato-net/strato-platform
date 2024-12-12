const {
  handleETHBridgeHashAdded,
} = require("./handleETHBridgeHashAdded");

async function handleMessage(messageData, token) {
  console.log("Received message:", messageData);

  try {
    const event = JSON.parse(messageData);
    switch (event?.eventEvent?.eventName) {
      case "ETHBridgeHashAdded":
        await handleETHBridgeHashAdded(event, token);
        break;

      default:
        console.warn(`Unhandled event type: ${event?.eventEvent?.eventName}`);
    }
  } catch (error) {
    console.error("Failed to process message:", messageData, error);
  }
}

module.exports = { handleMessage };
