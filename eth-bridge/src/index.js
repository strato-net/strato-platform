const { connectMercataWebSocket } = require("./sockets/mercataWebSocket");
const { setupAlchemyWebSocket } = require("./sockets/alchemyWebSocket");

const initializeSockets = async () => {
  try {
    // Initialize Marketplace WebSocket
    await connectMercataWebSocket();

    // Initialize Alchemy WebSocket
    await setupAlchemyWebSocket();
  } catch (error) {
    console.error("Error initializing sockets:", error);
  }
};

initializeSockets();
