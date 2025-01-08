const { Alchemy, Network, AlchemySubscription } = require("alchemy-sdk");
const { alchemyApiKey, alchemyNetwork, blockAppsPublicKey } = require("../config");
const { handleBridgeIn } = require("../events/bridgeIn");

const setupAlchemyWebSocket = async () => {
  const settings = {
    apiKey: alchemyApiKey,
    network: Network[alchemyNetwork],
  };
  const alchemy = new Alchemy(settings);

  alchemy.ws.on(
    {
      method: AlchemySubscription.MINED_TRANSACTIONS,
      addresses: [{ to: blockAppsPublicKey }],
      includeRemoved: true,
      hashesOnly: false,
    },
    async (tx) => {
      console.log("Mined Transaction:", tx);
      await handleBridgeIn(tx.transaction);
    }
  );

  console.log("Alchemy WebSocket setup complete");
};

module.exports = { setupAlchemyWebSocket };
