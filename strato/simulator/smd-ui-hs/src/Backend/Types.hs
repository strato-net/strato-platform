{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Backend.Types where

import Control.Exception
import Data.Aeson (ToJSON, FromJSON, Value)
import Data.Text (Text)
import GHC.Generics (Generic)

data BlockSummary = BlockSummary
  { blockHeight :: Integer
  , blockHash :: Text
  , txCount :: Integer
  , blockTime :: Integer
  } deriving (Show, Generic)

instance ToJSON BlockSummary
instance FromJSON BlockSummary

data UtxoSummary = UtxoSummary
  { address :: Text
  , amount :: Double
  , confirmations :: Int
  } deriving (Show, Generic)

instance ToJSON UtxoSummary
instance FromJSON UtxoSummary

data PostSendToMultisigArgs = PostSendToMultisigArgs
  { multisig_address :: Text
  , multisig_amount :: Double
  } deriving (Eq, Show, Generic)

instance ToJSON PostSendToMultisigArgs
instance FromJSON PostSendToMultisigArgs

data RpcCommand = RpcCommand
  { method :: Text
  , params :: [Value]
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

newtype BackendException = BackendException Text deriving (Eq, Show)

instance Exception BackendException