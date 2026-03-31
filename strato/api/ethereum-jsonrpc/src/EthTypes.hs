{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module EthTypes
  ( TransactionReceipt(..)
  ) where

import Blockchain.Data.DataDefs (TransactionResult(..))
import qualified Blockchain.Data.TransactionResultStatus as TRS
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToHex)
import Data.Aeson
import Numeric (showHex)

newtype TransactionReceipt = TransactionReceipt TransactionResult

ethHex :: Keccak256 -> Value
ethHex h = toJSON ("0x" ++ keccak256ToHex h)

intHex :: Integer -> Value
intHex n = toJSON ("0x" ++ showHex n "")

instance ToJSON TransactionReceipt where
  toJSON (TransactionReceipt TransactionResult{..}) =
    object
      [ "transactionHash"    .= ethHex transactionResultTransactionHash
      , "blockHash"          .= ethHex transactionResultBlockHash
      , "blockNumber"        .= ("0x0" :: String)
      , "transactionIndex"   .= ("0x0" :: String)
      , "from"               .= Null
      , "to"                 .= Null
      , "gasUsed"            .= intHex (toInteger transactionResultGasUsed)
      , "cumulativeGasUsed"  .= intHex (toInteger transactionResultGasUsed)
      , "contractAddress"    .= contractAddr
      , "logs"               .= ([] :: [Value])
      , "logsBloom"          .= zeroBloom
      , "status"             .= statusHex
      , "type"               .= ("0x0" :: String)
      ]
    where
      statusHex :: String
      statusHex = case transactionResultStatus of
        Just TRS.Success -> "0x1"
        _                -> "0x0"

      contractAddr :: Value
      contractAddr = case transactionResultContractsCreated of
        (a:_) -> toJSON ("0x" ++ show a)
        []    -> Null

      zeroBloom :: String
      zeroBloom = "0x" ++ replicate 512 '0'
