let latestBlockNumber = 0; // Variable to track the largest block number

async function filterMessages(msg) {
  try {
    if (msg === "pong") {
      // Handle the pong message
      console.log("Received pong message");
      return false;
    }

    let event;
    try {
      event = JSON.parse(msg);
    } catch (error) {
      console.error("Error parsing message:", error);
      return false; // Ignore invalid messages
    }

    // Check if the event and necessary properties exist
    const eventName = event?.eventEvent?.eventName;
    const currentBlockNumber = event?.eventBlockNumber;

    // If the block number is missing or not a number, ignore the message
    if (!currentBlockNumber || typeof currentBlockNumber !== 'number') {
      console.log("Invalid or missing block number");
      return false;
    }

    // If the block number is less than or equal to the last seen block number, ignore it
    if (currentBlockNumber < latestBlockNumber) {
      console.log("Ignoring old event with block number:", currentBlockNumber);
      return false;
    }

    // Update the latest block number
    latestBlockNumber = currentBlockNumber;

    // List of allowed event names
    const allowedEvents = ["CertificateRegistered", "Order"];

    // Check if the event name is one of the allowed events
    if (!eventName || !allowedEvents.includes(eventName)) {
      console.log("Event not allowed or missing event name:", eventName);
      return false;
    }
    console.log("Received event:", eventName);

    // The event passes all checks and is valid
    return true;
  } catch (error) {
    console.error("An unexpected error occurred:", error);
    return false; // Safely handle any unexpected error
  }
}

module.exports = { filterMessages };
