const { connectMercataWebSocket } = require('./sockets/mercataWebSocket');
const { setupAlchemyWebSocket } = require('./sockets/alchemyWebSocket');

const initializeSockets = async () => {
  try {
    // Initialize Marketplace WebSocket
    connectMercataWebSocket();

    // Initialize Alchemy WebSocket
    setupAlchemyWebSocket();

    console.log('All WebSocket connections initialized');
  } catch (error) {
    console.error('Error initializing sockets:', error);
  }
};

initializeSockets();