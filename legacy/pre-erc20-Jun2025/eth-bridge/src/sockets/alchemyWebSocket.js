const { Alchemy, Network, AlchemySubscription } = require("alchemy-sdk");
const {
  alchemyApiKey,
  alchemyNetwork,
  blockAppsPublicKey,
} = require("../config");
const { handleBridgeIn } = require("../events/bridgeIn");
const { ethers } = require("ethers");

const setupAlchemyWebSocket = async () => {
  const settings = {
    apiKey: alchemyApiKey,
    network: Network[alchemyNetwork],
  };
  const alchemy = new Alchemy(settings);

  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const formattedAddress = ethers.zeroPadValue(blockAppsPublicKey, 32);

  alchemy.ws.on(
    [
      transferTopic,
      null, // No filtering on the 'from' field.
      formattedAddress, // Filter for transfers to your address.
    ],
    async (log) => {
      console.log("ERC20 Transfer log from token", log.address, log);
      await handleBridgeIn({
        hash: log.transactionHash,
        value: 0,
        tx: log,
      });
    }
  );

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
