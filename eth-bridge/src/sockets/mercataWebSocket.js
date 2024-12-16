// src/sockets/marketplaceWebSocket.js
const WebSocket = require("ws");
const { getUserToken } = require("../auth");
const { marketplaceUrl } = require("../config");
// const { handleMessage } = require('../events/handleMessage'); // Uncomment if needed
// const { filterMessages } = require('../events/eventFilter'); // Uncomment if needed

const connectMercataWebSocket = async () => {
  let token = await getUserToken();

  const ws = new WebSocket(`wss://${marketplaceUrl}/eventstream`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const reconnect = () => {
    console.log("Reconnecting Marketplace WebSocket...");
    setTimeout(connectMercataWebSocket, 1000);
  };

  ws.on("open", () => {
    console.log("Marketplace WebSocket connected");

    const pingInterval = setInterval(async () => {
      try {
        ws.send("ping");
        token = await getUserToken();
      } catch (error) {
        console.error("Ping error:", error);
      }
    }, 50000);

    ws.on("close", () => {
      clearInterval(pingInterval);
      reconnect();
    });
  });

  ws.on("message", async (data) => {
    try {
      const message = data.toString();
      console.log("Message received:", message);
      //   if (await filterMessages(message)) {
      // await handleMessage(message, token);
      //   }
    } catch (error) {
      console.error("Message handling error:", error);
    }
  });

  ws.on("error", (error) => {
    console.error("Marketplace WebSocket error:", error);
    reconnect();
  });
};

module.exports = { connectMercataWebSocket };
