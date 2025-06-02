{-# LANGUAGE TemplateHaskell #-}

module Blockchain.GenesisBlocks.Contracts.Mercata where

import           Data.ByteString       (ByteString)
import qualified Data.ByteString.Char8 as BC
import           Data.FileEmbed        (embedDir)
import           Data.Map              (Map)
import qualified Data.Map              as Map
import           Data.Maybe
import           System.FilePath       (takeFileName)

filesToEmbed :: [String]
filesToEmbed = [
  "contracts/v1/abstract/BaseCodeCollection.sol",
  "contracts/v1/abstract/Bridge/MercataEthBridge.sol",
  "contracts/v1/abstract/Enums/RestStatus.sol",
  "contracts/v1/abstract/ERC20/ERC20.sol",
  "contracts/v1/abstract/ERC20/IERC20.sol",
  "contracts/v1/abstract/ERC20/access/Ownable.sol",
  "contracts/v1/abstract/ERC20/extensions/IERC20Metadata.sol",
  "contracts/v1/abstract/ERC20/utils/Context.sol",
  "contracts/v1/abstract/Pools/Pool.sol",
  "contracts/v1/abstract/Pools/PoolFactory.sol",
  "contracts/v1/abstract/Tokens/Token.sol",
  "contracts/v1/abstract/Tokens/TokenAccess.sol",
  "contracts/v1/abstract/Tokens/TokenFaucet.sol",
  "contracts/v1/abstract/Tokens/Metadata/TokenMetadata.sol",
  "contracts/v1/abstract/Utils/ReentrancyGuard.sol",
  "contracts/v1/abstract/Utils/Subscriber.sol",
  "contracts/v1/abstract/Utils/Utils.sol",
  "contracts/v1/concrete/Lending/CollateralVault.sol",
  "contracts/v1/concrete/Lending/LendingPool.sol",
  "contracts/v1/concrete/Lending/LendingRegistry.sol",
  "contracts/v1/concrete/Lending/LiquidityPool.sol",
  "contracts/v1/concrete/Lending/PoolConfigurator.sol",
  "contracts/v1/concrete/Lending/PriceOracle.sol",
  "contracts/v1/concrete/Lending/RateStrategy.sol",
  "contracts/v1/concrete/OnRamp/OnRamp.sol"
  ]


embeddedFiles :: [(FilePath, ByteString)]
embeddedFiles = $(embedDir "resources")

fileMap :: Map FilePath ByteString
fileMap = Map.fromList embeddedFiles



----------------------


mercataContracts :: [[String]]
mercataContracts=map (\filename -> [takeFileName filename, BC.unpack $ fromMaybe (error $ "internal error finding source code in genesis resources: " ++ show filename) $ Map.lookup filename fileMap]) filesToEmbed
