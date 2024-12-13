const { Alchemy, Network, AlchemySubscription } = require('alchemy-sdk');
const { alchemyApiKey, alchemyNetwork } = require('../config/config');
const { handleBridgeIn } = require('../events/bridgeIn');

const setupAlchemyWebSocket = () => {
  const settings = {
    apiKey: alchemyApiKey,
    network: Network[alchemyNetwork],
  };
  const alchemy = new Alchemy(settings);

  alchemy.ws.on(
    {
      method: AlchemySubscription.MINED_TRANSACTIONS,
      addresses: [
        { from: '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E' },
        { to: '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E' },
      ],
      includeRemoved: true,
      hashesOnly: false,
    },
    async (tx) => {
      console.log('Mined Transaction:', tx);
        await handleBridgeIn(tx);
    }
  );

  console.log('Alchemy WebSocket setup complete');
};

module.exports = { setupAlchemyWebSocket };