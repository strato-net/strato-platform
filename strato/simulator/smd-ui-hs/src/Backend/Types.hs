{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Backend.Types where

import Control.Applicative ((<|>))
import Control.Exception
import Data.Aeson
import qualified Data.ByteString.Lazy as BL
import Data.Scientific (Scientific, toRealFloat)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding
import GHC.Generics (Generic)

sci2Int :: Scientific -> Integer
sci2Int n = round (toRealFloat n :: Double) 

data BitcoinBlockSummary = BitcoinBlockSummary
  { blockHeight :: Integer
  , blockHash :: Text
  , txCount :: Integer
  , blockTime :: Integer
  } deriving (Show, Generic)

instance ToJSON BitcoinBlockSummary
instance FromJSON BitcoinBlockSummary where
  parseJSON = withObject "BitcoinBlockSummary" $ \o ->
    let option1 = do
          ht <- sci2Int <$> o .: "height"
          h  <- o .: "hash"
          n  <- sci2Int <$> o .: "nTx"
          t <- sci2Int <$> o .: "time"
          pure $ BitcoinBlockSummary ht h n t
        option2 = do
          ht <- o .: "blockHeight"
          h  <- o .: "blockHash"
          n  <- o .: "txCount"
          t <- o .: "blockTime"
          pure $ BitcoinBlockSummary ht h n t
     in option1 <|> option2 <|> fail "Failed to parse BitcoinBlockSummary"

data UTXO = UTXO
  { uTxid     :: Text
  , uVout     :: Int
  , uAddress  :: Text
  , uAmount   :: Double
  , uScriptPubKey :: Text
  } deriving (Show, Generic)

instance ToJSON UTXO
instance FromJSON UTXO where
  parseJSON = withObject "UTXO" $ \o ->
    let option1 = do
          txid <- o .: "txid"
          vout <- fromInteger . sci2Int <$> o .: "vout"
          addr <- o .: "address"
          amt  <- toRealFloat <$> o .: "amount"
          pub <- o .: "scriptPubKey"
          pure $ UTXO txid vout addr amt pub
        option2 = do
          txid <- o .: "uTxid"
          vout <- o .: "uVout"
          addr <- o .: "uAddress"
          amt  <- o .: "uAmount"
          pub <- o .: "uScriptPubKey"
          pure $ UTXO txid vout addr amt pub
     in option1 <|> option2 <|> fail "Failed to parse UTXO"

data UtxoSummary = UtxoSummary
  { usAddress :: Text
  , usAmount :: Double
  , usConfirmations :: Int
  } deriving (Show, Generic)

instance ToJSON UtxoSummary
instance FromJSON UtxoSummary where
  parseJSON = withObject "UtxoSummary" $ \o ->
    let option1 = do
          addr <- o .: "address"
          amt  <- toRealFloat <$> o .: "amount"
          conf  <- fromInteger . sci2Int <$> o .: "confirmations"
          pure $ UtxoSummary addr amt conf
        option2 = do
          addr <- o .: "usAddress"
          amt  <- o .: "usAmount"
          conf  <- o .: "usConfirmations"
          pure $ UtxoSummary addr amt conf
     in option1 <|> option2 <|> fail "Failed to parse UtxoSummary"

data PostSendToMultisigArgs = PostSendToMultisigArgs
  { multisig_address :: Text
  , multisig_amount :: Double
  } deriving (Eq, Show, Generic)

instance ToJSON PostSendToMultisigArgs
instance FromJSON PostSendToMultisigArgs

data RpcCommand = RpcCommand
  { rpcMethod :: Text
  , rpcParams :: [Value]
  } deriving (Show, Generic)

instance FromJSON RpcCommand
instance ToJSON RpcCommand

data Transaction = Transaction
  { txId       :: Int
  , txType     :: Text
  , txAsset    :: Text
  , txImageUrl :: Text
  , txQuantity :: Int
  , txPrice    :: Maybe Double
  , txBuyer    :: Text
  , txSeller   :: Text
  , txHash     :: Maybe Text
  , txDate     :: Text  -- ideally parse to UTCTime
  , txStatus   :: Text
  } deriving (Generic, Show)

instance FromJSON Transaction
instance ToJSON Transaction

data WalletItem = WalletItem
  { wiIcon       :: Text
  , wiSymbol     :: Text
  , wiCategory   :: Text
  , wiPrice      :: Text
  , wiOwned      :: Double
  , wiListed     :: Int
  , wiStatus     :: Text
  , wiStaked     :: Bool
  , wiBorrowed   :: Maybe Double
  } deriving (Generic, Show)

instance FromJSON WalletItem
instance ToJSON WalletItem

data Activity = Activity
  { actType      :: Text
  , actAsset     :: Text
  , actQuantity  :: Double
  , actPrice     :: Maybe Double
  , actBuyer     :: Text
  , actSeller    :: Text
  , actTimestamp :: Text
  } deriving (Generic, Show)

instance FromJSON Activity
instance ToJSON Activity

data AddressValidation = AddressValidation
  { avIsValid :: Bool
  , avAddress :: Text
  , avScriptPubKey :: Text
  , avIsScript :: Bool
  } deriving (Show, Generic)

instance ToJSON AddressValidation
instance FromJSON AddressValidation where
  parseJSON = withObject "AddressValidation" $ \o ->
    let option1 = do
          isValid <- o .: "isvalid"
          addr <- o .: "address"
          spk <- o .: "scriptPubKey"
          script <- o .: "isscript"
          pure $ AddressValidation isValid addr spk script
        option2 = do
          isValid <- o .: "avIsValid"
          addr <- o .: "avAddress"
          spk <- o .: "avScriptPubKey"
          script <- o .: "avIsScript"
          pure $ AddressValidation isValid addr spk script
     in option1 <|> option2 <|> fail ("Failed to parse AddressValidation: " ++ show o)

newtype BackendException = BackendException Text deriving (Eq, Show)

instance Exception BackendException

data MultiSigAddress = MultiSigAddress
  { maAddress :: Text
  , maRedeemScript :: Text
  } deriving (Show, Generic)

instance ToJSON MultiSigAddress
instance FromJSON MultiSigAddress where
  parseJSON = withObject "MultiSigAddress" $ \o ->
    let option1 = do
          addr <- o .: "address"
          rs <- o .: "redeemScript"
          pure $ MultiSigAddress addr rs
        option2 = do
          addr <- o .: "maAddress"
          rs <- o .: "maRedeemScript"
          pure $ MultiSigAddress addr rs
     in option1 <|> option2 <|> fail "Failed to parse MultiSigAddress"

newtype StringedListOf a = StringedListOf { getStringedListOf :: [a] }

instance ToJSON a => ToJSON (StringedListOf a) where
  toJSON (StringedListOf as) = String . decodeUtf8 . BL.toStrict $ encode as
instance FromJSON a => FromJSON (StringedListOf a) where
  parseJSON (String a) = case decode . BL.fromStrict $ encodeUtf8 a of
    Nothing -> fail $ "Could not decode stringed list: " ++ T.unpack a
    Just xs -> pure xs
  parseJSON o = fail $ "Could not decode stringed list: " ++ show o