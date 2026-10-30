{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}

module TransactionReceipt
  ( TransactionReceipt(..)
  , EthHex(..)
  , mkTransactionReceipt
  , walletGasEstimate
  ) where

import Blockchain.Data.DataDefs (TransactionResult(..))
import qualified Blockchain.Data.TransactionResultStatus as TRS
import Blockchain.Data.Transaction (Transaction, whoSignedThisTransaction)
import Blockchain.Strato.Model.Class (txEnvelopeType)
import qualified Blockchain.Data.Transaction as TX
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToHex, stringKeccak256)
import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.Text as T
import GHC.Generics (Generic)
import Numeric (showHex)

-- | The single (de)serialization boundary for Ethereum JSON-RPC hex values:
-- ToJSON always emits the @0x@-prefixed form, FromJSON accepts it (with or
-- without the prefix). Keeping the @0x@ convention here means the internal
-- types (Keccak256, Address, ...) stay in their bare STRATO form and no
-- handler has to massage prefixes by hand.
newtype EthHex a = EthHex a

instance ToJSON (EthHex Integer) where
  toJSON (EthHex n) = toJSON $ "0x" ++ showHex n ""

instance ToJSON (EthHex Keccak256) where
  toJSON (EthHex h) = toJSON $ "0x" ++ keccak256ToHex h

instance ToJSON (EthHex Address) where
  toJSON (EthHex a) = toJSON $ "0x" ++ show a

instance FromJSON (EthHex Keccak256) where
  parseJSON = withText "EthHex Keccak256" $ \t ->
    let s = case T.unpack t of
              '0':'x':rest -> rest
              '0':'X':rest -> rest
              rest         -> rest
     in maybe (fail $ "error parsing Keccak256: " ++ show t) (pure . EthHex) (stringKeccak256 s)

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
  , effectiveGasPrice :: EthHex Integer
  } deriving (Generic)

-- | The billable gas units of every transaction: eth_estimateGas answers it,
-- eth_gasPrice spreads the flat fee over it, and receipts bill it, so the
-- estimate and the receipt agree to within the rounding of one unit.
walletGasEstimate :: Integer
walletGasEstimate = 21000

instance ToJSON TransactionReceipt where
  toJSON = genericToJSON defaultOptions { fieldLabelModifier = fixType }
    where
      fixType "type_" = "type"
      fixType name    = name

-- | @feeCharged@ is what the payer was charged in the native currency; the
-- receipt bills it as the billable gas units at the per-unit price that
-- covers it, so @gasUsed * effectiveGasPrice@ is the charge up to rounding.
mkTransactionReceipt :: TransactionResult -> Transaction -> Integer -> Integer -> [Value] -> String -> TransactionReceipt
mkTransactionReceipt tr tx blkNum feeCharged theLogs theLogsBloom = TransactionReceipt
  { transactionHash   = EthHex (transactionResultTransactionHash tr)
  , blockHash         = EthHex (transactionResultBlockHash tr)
  , blockNumber       = EthHex blkNum
  , transactionIndex  = EthHex 0
  , from              = EthHex <$> whoSignedThisTransaction tx
  , to                = EthHex <$> txTo tx
  , gasUsed           = EthHex walletGasEstimate
  , cumulativeGasUsed = EthHex walletGasEstimate
  , contractAddress   = if isNativeTransfer
      then Nothing
      else case transactionResultContractsCreated tr of
        (a:_) -> Just (EthHex a)
        []    -> Nothing
  , logs              = theLogs
  , logsBloom         = theLogsBloom
  , status            = EthHex $ if transactionResultStatus tr == Just TRS.Success then 1 else 0
  , type_             = EthHex (toInteger $ txEnvelopeType tx)
  , effectiveGasPrice = EthHex ((feeCharged + walletGasEstimate - 1) `div` walletGasEstimate)
  }
  where

    isNativeTransfer = case tx of
      TX.EthereumTX{TX.ethTo = Just _, TX.value = val, TX.txData = td}
        | B.null td && val > 0 -> True
      _ -> False

    txTo :: Transaction -> Maybe Address
    txTo TX.EthereumTX{TX.ethTo = mTo} = mTo
    txTo TX.MessageTX{TX.to = addr} = Just addr
    txTo _ = Nothing
