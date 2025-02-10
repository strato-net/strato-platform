const { Alchemy, Network, AlchemySubscription } = require("alchemy-sdk");
const { alchemyApiKey, alchemyNetwork, blockAppsPublicKey, wbtcContractAddress } = require("../config");
const { handleBridgeIn } = require("../events/bridgeIn");
const { ethers } = require("ethers");

const setupAlchemyWebSocket = async () => {
  const settings = {
    apiKey: alchemyApiKey,
    network: Network[alchemyNetwork],
  };
  const alchemy = new Alchemy(settings);

  const erc20Filter = {
    address: wbtcContractAddress, // Set to null to listen to all ERC-20 tokens, or set a specific token address
    topics: [ethers.id("Transfer(address,address,uint256)")],
  };

  alchemy.ws.on(erc20Filter, async (tx) => {
    console.log("Mined Transaction:", tx);
    await handleBridgeIn({hash: tx.transactionHash, value: 0, tx });
  });

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
