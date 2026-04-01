{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}

module TransactionReceipt
  ( TransactionReceipt(..)
  , mkTransactionReceipt
  ) where

import Blockchain.Data.DataDefs (TransactionResult(..))
import qualified Blockchain.Data.TransactionResultStatus as TRS
import Blockchain.Data.Transaction (Transaction, whoSignedThisTransaction)
import qualified Blockchain.Data.Transaction as TX
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToHex)
import Data.Aeson
import qualified Data.ByteString as B
import GHC.Generics (Generic)
import Numeric (showHex)

newtype EthHex a = EthHex a

instance ToJSON (EthHex Integer) where
  toJSON (EthHex n) = toJSON $ "0x" ++ showHex n ""

instance ToJSON (EthHex Keccak256) where
  toJSON (EthHex h) = toJSON $ "0x" ++ keccak256ToHex h

instance ToJSON (EthHex Address) where
  toJSON (EthHex a) = toJSON $ "0x" ++ show a

data TransactionReceipt = TransactionReceipt
  { transactionHash   :: EthHex Keccak256
  , blockHash         :: EthHex Keccak256
  , blockNumber       :: EthHex Integer
  , transactionIndex  :: EthHex Integer
  , from              :: Maybe (EthHex Address)
  , to                :: Maybe (EthHex Address)
  , gasUsed           :: EthHex Integer
  , cumulativeGasUsed :: EthHex Integer
  , contractAddress   :: Maybe (EthHex Address)
  , logs              :: [Value]
  , logsBloom         :: String
  , status            :: EthHex Integer
  , type_             :: EthHex Integer
  } deriving (Generic)

instance ToJSON TransactionReceipt where
  toJSON = genericToJSON defaultOptions { fieldLabelModifier = fixType }
    where
      fixType "type_" = "type"
      fixType name    = name

mkTransactionReceipt :: TransactionResult -> Transaction -> Integer -> TransactionReceipt
mkTransactionReceipt tr tx blkNum = TransactionReceipt
  { transactionHash   = EthHex (transactionResultTransactionHash tr)
  , blockHash         = EthHex (transactionResultBlockHash tr)
  , blockNumber       = EthHex blkNum
  , transactionIndex  = EthHex 0
  , from              = EthHex <$> whoSignedThisTransaction tx
  , to                = EthHex <$> txTo tx
  , gasUsed           = EthHex gas
  , cumulativeGasUsed = EthHex gas
  , contractAddress   = if isNativeTransfer
      then Nothing
      else case transactionResultContractsCreated tr of
        (a:_) -> Just (EthHex a)
        []    -> Nothing
  , logs              = []
  , logsBloom         = "0x" ++ replicate 512 '0'
  , status            = EthHex $ if transactionResultStatus tr == Just TRS.Success then 1 else 0
  , type_             = EthHex 0
  }
  where
    gas = toInteger (transactionResultGasUsed tr)

    isNativeTransfer = case tx of
      TX.EthereumTX{TX.ethTo = Just _, TX.value = val, TX.txData = td}
        | B.null td && val > 0 -> True
      _ -> False

    txTo :: Transaction -> Maybe Address
    txTo TX.EthereumTX{TX.ethTo = mTo} = mTo
    txTo TX.MessageTX{TX.to = addr} = Just addr
    txTo _ = Nothing
