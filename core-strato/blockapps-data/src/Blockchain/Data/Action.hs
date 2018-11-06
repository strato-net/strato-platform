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
  { _callType    :: CallType
  , _sender      :: Address
  , _owner       :: Address
  , _gasPrice    :: Integer
  , _value       :: Integer
  , _input       :: ByteString
  , _output      :: Maybe ByteString
  } deriving (Show, Generic, NFData)
makeLenses ''CallData

instance ToJSON CallData where
  toJSON CallData{..} = object
    [ "type"    .= _callType
    , "sender"  .= _sender
    , "owner"   .= _owner
    , "gasPrice".= _gasPrice
    , "value"   .= _value
    , "input"   .= _input
    , "output"  .= _output
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
  { _codeHash     :: SHA
  , _storageDiffs :: Map Word256 Word256
  , _callData     :: [CallData]
  } deriving (Show, Generic, NFData)
makeLenses ''ActionData

mergeActionData :: ActionData -> ActionData -> ActionData
mergeActionData newData oldData =
  let diffs = M.union (_storageDiffs newData) (_storageDiffs oldData)
      calls = (_callData oldData) ++ (_callData newData)
   in ActionData (_codeHash oldData) diffs calls

instance ToJSON ActionData where
  toJSON ActionData{..} = object
    [ "codeHash" .= _codeHash
    , "diff"     .= _storageDiffs
    , "data"     .= _callData
    ]

instance FromJSON ActionData where
  parseJSON (Object o) = ActionData
    <$> (o .: "codeHash")
    <*> (o .: "diff")
    <*> (o .: "data")
  parseJSON o = error $ "parseJSON ActionData: Expected object, got: " ++ show o

data Action = Action
  { _blockHash          :: SHA
  , _blockTimestamp     :: UTCTime
  , _blockNumber        :: Integer
  , _transactionHash    :: SHA
  , _transactionChainId :: Maybe Word256
  , _transactionSender  :: Address
  , _actionData         :: Map Address ActionData
  , _metadata           :: Maybe (Map Text Text)
  } deriving (Show, Generic, NFData)
makeLenses ''Action

instance ToJSON Action where
  toJSON Action{..} = object
    [ "blockHash"       .= _blockHash
    , "blockTimestamp"  .= _blockTimestamp
    , "blockNumber"     .= _blockNumber
    , "transactionHash" .= _transactionHash
    , "chainId"         .= _transactionChainId
    , "sender"          .= _transactionSender
    , "data"            .= _actionData
    , "metadata"        .= _metadata
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
