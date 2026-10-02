require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();
const { NETWORKS } = require("./scripts/lib/externalBridgeNetworks");

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];
const externalNetworks = Object.fromEntries(NETWORKS.map(({ name, rpcEnv, defaultRpcUrl }) => [name, {
  url: process.env[rpcEnv] || (name === "mainnet" ? undefined : defaultRpcUrl),
  accounts,
  gasPrice: "auto",
}]));

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
    robinhoodTestnet: {
      url:
        process.env.ROBINHOOD_TESTNET_RPC_URL ||
        "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts,
      gasPrice: "auto",
    },
    robinhood: {
      url:
        process.env.ROBINHOOD_RPC_URL ||
        "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts,
      gasPrice: "auto",
    },
    hyperEvm: {
      url: process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
      chainId: 999,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  sourcify: {
    enabled: false,
  },
}; 
