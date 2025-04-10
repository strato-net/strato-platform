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
  "dapp/mercata-base-contracts/Templates/Assets/Mintable.sol",
  "dapp/mercata-base-contracts/Templates/Assets/SemiFungible.sol",
  "dapp/mercata-base-contracts/Templates/Assets/UTXO.sol",
  "dapp/mercata-base-contracts/Templates/Assets/Redeemable.sol",
  "dapp/mercata-base-contracts/Templates/Assets/LendingToken.sol",
  "dapp/mercata-base-contracts/Templates/Enums/RestStatus.sol",
  "dapp/mercata-base-contracts/Templates/Escrows/Escrow.sol",
  "dapp/mercata-base-contracts/Templates/Escrows/SimpleEscrow.sol",
  "dapp/mercata-base-contracts/Templates/Payments/PaymentService.sol",
  "dapp/mercata-base-contracts/Templates/Payments/TokenPaymentService.sol",
  "dapp/mercata-base-contracts/Templates/Oracles/OracleService.sol",
  "dapp/mercata-base-contracts/Templates/Redemptions/RedemptionService.sol",
  "dapp/mercata-base-contracts/Templates/Sales/Sale.sol",
  "dapp/mercata-base-contracts/Templates/Staking/Reserve.sol",
  "dapp/mercata-base-contracts/Templates/Staking/SimpleReserve.sol",
  "dapp/mercata-base-contracts/Templates/Staking/MinterAuthorization.sol",
  "dapp/mercata-base-contracts/Templates/Utils/Utils.sol",
  "dapp/mercata-base-contracts/Templates/Structs/Structs.sol",
  "dapp/mercata-base-contracts/Templates/Bridge/MercataETHBridge.sol",
  "dapp/items/contracts/Tokens.sol",
  "dapp/items/contracts/Spirits.sol",
  "dapp/items/contracts/Membership.sol",
  "dapp/items/contracts/Clothing.sol",
  "dapp/items/contracts/CarbonOffset.sol",
  "dapp/items/contracts/Collectibles.sol",
  "dapp/items/contracts/Metals.sol",
  "dapp/items/contracts/Art.sol",
  "dapp/items/contracts/BridgeableTokens.sol"
  ]


embeddedFiles :: [(FilePath, ByteString)]
embeddedFiles = $(embedDir "resources")

fileMap :: Map FilePath ByteString
fileMap = Map.fromList embeddedFiles



----------------------


mercataContracts :: [[String]]
mercataContracts=map (\filename -> [takeFileName filename, BC.unpack $ fromMaybe (error $ "internal error finding source code in genesis resources: " ++ show filename) $ Map.lookup filename fileMap]) filesToEmbed
