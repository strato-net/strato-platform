require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();
const { NETWORKS } = require("./scripts/lib/externalBridgeNetworks");

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];
const externalNetworks = Object.fromEntries(NETWORKS.flatMap(({ chainId, name, rpcEnv, defaultRpcUrl }) => {
  const url = process.env[rpcEnv] || defaultRpcUrl;
  return url ? [[name, { url, chainId, accounts, gasPrice: "auto" }]] : [];
}));
const customChains = NETWORKS.filter(({ explorerApiUrl, explorerUrl }) => explorerApiUrl && explorerUrl)
  .map(({ name, chainId, explorerApiUrl, explorerUrl }) => ({
    network: name, chainId, urls: { apiURL: explorerApiUrl, browserURL: explorerUrl },
  }));
const explorerApiKeys = Object.fromEntries(NETWORKS.map(({ name, explorerApiUrl }) => [
  name, explorerApiUrl ? process.env.BLOCKSCOUT_API_KEY || "blockscout" : process.env.ETHERSCAN_API_KEY || "",
]));

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [{
      version: "0.8.26",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    }],
    overrides: {
      "contracts/bridge/StratoNativeRepresentationBridge.sol": {
        version: "0.8.26",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
    },
  },
  networks: {
    ...externalNetworks,
    hardhat: process.env.FORK_RPC_URL
      ? { forking: { url: process.env.FORK_RPC_URL, blockNumber: process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined } }
      : {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
  etherscan: {
    apiKey: explorerApiKeys,
    customChains,
  },
  sourcify: {
    enabled: true,
  },
}; 
