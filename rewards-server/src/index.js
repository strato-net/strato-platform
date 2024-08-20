const WebSocket = require("ws");
const { getUserToken } = require("./auth");
const { handleMessage } = require("./events/handleMessage");
const { NODE_ENV, prodMarketplaceUrl, testnetMarketplaceUrl } = require("./config");
const { filterMessages } = require("./helper/eventFilter");

// Function to establish WebSocket connection
async function connectWebSocket() {
  let token = await getUserToken();

  const wsUrl = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl;

  // Initialize WebSocket connection with authorization header
  const ws = new WebSocket(`wss://${wsUrl}/eventstream`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  // Function to handle reconnecting with a new token
  const reconnectWebSocket = async () => {
    try {
      console.log("Reconnecting WebSocket with new token...");
      connectWebSocket();
    } catch (error) {
      console.error("Error reconnecting WebSocket:", error);
      setTimeout(reconnectWebSocket, 1000); // Retry after 1 second
    }
  };

  // Event: WebSocket connection opened
  ws.on("open", () => {
    console.log("WebSocket connection opened");

    // Send ping every 50 seconds to keep connection alive
    const pingInterval = setInterval(async () => {
      try {
        ws.send("ping");
        token = await getUserToken();
      } catch (error) {
        console.error("Error sending ping:", error);
      }
    }, 50000);

    // Clear ping interval and reconnect on close
    ws.on("close", () => {
      console.log("WebSocket connection closed, reconnecting...");
      clearInterval(pingInterval);
      reconnectWebSocket();
    });
  });

  // Event: Message received from WebSocket
  ws.on("message", async (data) => {
    try {
      const messageData = data.toString();
      if (await filterMessages(messageData)) {
        await handleMessage(messageData, token);
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  });

  // Reconnect on WebSocket error
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    reconnectWebSocket();
  });
}

// Initiate WebSocket connection
connectWebSocket();
