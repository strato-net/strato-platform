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
  "dapp/mercata-base-contracts/BaseCodeCollection.sol",
  "dapp/mercata-base-contracts/Templates/Assets/Asset.sol",
  "dapp/mercata-base-contracts/Templates/ERC20/access/Ownable.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC20Burnable.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC20Capped.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC20FlashMint.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC20Pausable.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC20Permit.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC20Votes.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC20Wrapper.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC1363.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/ERC4626.sol",
  "dapp/mercata-base-contracts/Templates/ERC20/extensions/IERC20Metadata.sol",
  -- "dapp/mercata-base-contracts/Templates/ERC20/extensions/IERC20Permit.sol",
  "dapp/mercata-base-contracts/Templates/ERC20/utils/Context.sol",
  "dapp/mercata-base-contracts/Templates/ERC20/ERC20.sol",
  "dapp/mercata-base-contracts/Templates/ERC20/ERC20Asset.sol",
  "dapp/mercata-base-contracts/Templates/ERC20/ERC20Simple.sol",
  "dapp/mercata-base-contracts/Templates/ERC20/IERC20.sol",
  "dapp/mercata-base-contracts/Templates/Enums/RestStatus.sol",
  "dapp/mercata-base-contracts/Templates/Escrows/Escrow.sol",
  "dapp/mercata-base-contracts/Templates/Escrows/SimpleEscrow.sol",
  "dapp/mercata-base-contracts/Templates/Sales/Sale.sol",
  "dapp/mercata-base-contracts/Templates/Staking/Reserve.sol",
  "dapp/mercata-base-contracts/Templates/Staking/SimpleReserve.sol",
  "dapp/mercata-base-contracts/Templates/Structs/Structs.sol"
  ]


embeddedFiles :: [(FilePath, ByteString)]
embeddedFiles = $(embedDir "resources")

fileMap :: Map FilePath ByteString
fileMap = Map.fromList embeddedFiles



----------------------


mercataContracts :: [[String]]
mercataContracts=map (\filename -> [takeFileName filename, BC.unpack $ fromMaybe (error $ "internal error finding source code in genesis resources: " ++ show filename) $ Map.lookup filename fileMap]) filesToEmbed
