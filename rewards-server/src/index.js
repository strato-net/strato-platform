// src/index.js
const WebSocket = require("ws");
const { getUserToken } = require("./auth");
const { handleMessage } = require("./events/handleMessage");
const { NODE, prodMarketplaceUrl, testnetMarketplaceUrl } = require("./config");
const { filterMessages } = require("./helper/eventFilter");

async function connectWebSocket() {
  const token = await getUserToken();
  const wsUrl = NODE === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl;
  const ws = new WebSocket(
    `wss://${wsUrl}/eventstream`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  ws.on("open", () => {
    console.log("WebSocket connection opened");
    setInterval(() => ws.send("ping"), 50000); // Send ping every 50 seconds to keep connection alive
  });

  ws.on("message", async (data) => {
    try {
      const messageData = data.toString();
      if (await filterMessages(messageData)) {
        await handleMessage(messageData, token);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      // Do not close the connection if handleMessage fails
    }
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed, reconnecting...");
    setTimeout(connectWebSocket, 1000); // Reconnect after 1 second
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    // Do not close the connection if an error occurs
  });
}

connectWebSocket();
