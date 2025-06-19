const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "config", "latestBlock.json");

let latestBlockNumber;
try {
  const block = JSON.parse(
    fs.readFileSync(filePath, "utf-8")
  )?.latestBlockNumber;

  latestBlockNumber = block === null || isNaN(block) ? 0 : block;
  console.log("Loaded block number:", latestBlockNumber);
} catch (error) {
  console.error("Error reading or parsing latestBlock.json:", error);
  latestBlockNumber = 0;
}

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
    if (!currentBlockNumber || typeof currentBlockNumber !== "number") {
      console.log("Invalid or missing block number");
      return false;
    }

    // If the block number is less than or equal to the last seen block number, ignore it
    if (currentBlockNumber < latestBlockNumber) {
      return false;
    }

    // Update the latest block number
    fs.writeFileSync(
      filePath,
      JSON.stringify({ latestBlockNumber: currentBlockNumber }),
      "utf-8"
    );

    // List of allowed event names
    const allowedEvents = ["BurnedETHST"];

    // Check if the event name is one of the allowed events
    if (!eventName || !allowedEvents.includes(eventName)) {
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
