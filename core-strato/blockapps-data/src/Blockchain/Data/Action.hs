{-# LANGUAGE DeriveAnyClass       #-}
{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE RecordWildCards      #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.Action where

import           Blockchain.Data.Address
import           Blockchain.ExtWord           (Word256)
import           Blockchain.MiscJSON()
import           Blockchain.SHA
import           Control.DeepSeq
import           Control.Lens                 hiding ((.=))
import           Data.Aeson
import           Data.ByteString              (ByteString)
import           Data.Function                (on)
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Text                    (Text)
import           Data.Time
import           GHC.Generics

instance FromJSONKey Address where
    fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

data CallType = Create | Delete | Update deriving (Eq, Show, Generic, NFData)

instance ToJSON CallType where
instance FromJSON CallType where

data CallData = CallData
  { _callDataType     :: CallType
  , _callDataSender   :: Address
  , _callDataOwner    :: Address
  , _callDataGasPrice :: Integer
  , _callDataValue    :: Integer
  , _callDataInput    :: ByteString
  , _callDataOutput   :: Maybe ByteString
  } deriving (Show, Generic, NFData)
makeLenses ''CallData

instance ToJSON CallData where
  toJSON CallData{..} = object
    [ "type"    .= _callDataType
    , "sender"  .= _callDataSender
    , "owner"   .= _callDataOwner
    , "gasPrice".= _callDataGasPrice
    , "value"   .= _callDataValue
    , "input"   .= _callDataInput
    , "output"  .= _callDataOutput
    ]

instance FromJSON CallData where
  parseJSON (Object o) = CallData
    <$> (o .: "type")
    <*> (o .: "sender")
    <*> (o .: "owner")
    <*> (o .: "gasPrice")
    <*> (o .: "value")
    <*> (o .: "input")
    <*> (o .:? "output")
  parseJSON o = error $ "parseJSON CallData: Expected object, got: " ++ show o

data ActionData = ActionData
  { _actionDataCodeHash     :: SHA
  , _actionDataStorageDiffs :: Map Word256 Word256
  , _actionDataCallData     :: [CallData]
  } deriving (Show, Generic, NFData)
makeLenses ''ActionData

mergeActionData :: ActionData -> ActionData -> ActionData
mergeActionData newData oldData =
  let diffs = (M.union `on` _actionDataStorageDiffs) newData oldData
      calls = ((++) `on` _actionDataCallData) oldData newData
   in ActionData (_actionDataCodeHash oldData) diffs calls

instance ToJSON ActionData where
  toJSON ActionData{..} = object
    [ "codeHash" .= _actionDataCodeHash
    , "diff"     .= _actionDataStorageDiffs
    , "data"     .= _actionDataCallData
    ]

instance FromJSON ActionData where
  parseJSON (Object o) = ActionData
    <$> (o .: "codeHash")
    <*> (o .: "diff")
    <*> (o .: "data")
  parseJSON o = error $ "parseJSON ActionData: Expected object, got: " ++ show o

data Action = Action
  { _actionBlockHash          :: SHA
  , _actionBlockTimestamp     :: UTCTime
  , _actionBlockNumber        :: Integer
  , _actionTransactionHash    :: SHA
  , _actionTransactionChainId :: Maybe Word256
  , _actionTransactionSender  :: Address
  , _actionData               :: Map Address ActionData
  , _actionMetadata           :: Maybe (Map Text Text)
  } deriving (Show, Generic, NFData)
makeLenses ''Action

instance ToJSON Action where
  toJSON Action{..} = object
    [ "blockHash"       .= _actionBlockHash
    , "blockTimestamp"  .= _actionBlockTimestamp
    , "blockNumber"     .= _actionBlockNumber
    , "transactionHash" .= _actionTransactionHash
    , "chainId"         .= _actionTransactionChainId
    , "sender"          .= _actionTransactionSender
    , "data"            .= _actionData
    , "metadata"        .= _actionMetadata
    ]

instance FromJSON Action where
  parseJSON (Object o) = Action
    <$> (o .: "blockHash")
    <*> (o .: "blockTimestamp")
    <*> (o .: "blockNumber")
    <*> (o .: "transactionHash")
    <*> (o .:? "chainId")
    <*> (o .: "sender")
    <*> (o .: "data")
    <*> (o .: "metadata")
  parseJSON o = error $ "parseJSON Action: Expected object, got: " ++ show o
