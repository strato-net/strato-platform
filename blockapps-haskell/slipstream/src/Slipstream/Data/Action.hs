{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , FlexibleInstances
#-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Data.Action where

import           BlockApps.Ethereum
import           Control.DeepSeq
import           Control.Lens            hiding ((.=))
import qualified Data.Aeson.Encoding     as AesonEnc
import           Data.Aeson.Types
import           Data.ByteString         (ByteString)
import           Data.Map.Strict         (Map)
import qualified Data.Map.Strict         as M
import           Data.Maybe              (fromMaybe,listToMaybe)
import           Data.Text               (Text)
import qualified Data.Text               as T
import           Data.Time
import           GHC.Generics

import qualified Blockchain.Strato.Model.Action as BS
import           Blockchain.SolidVM.Model

instance (Integral a, Show a) => ToJSONKey (Hex a) where
  toJSONKey = ToJSONKeyText f g
    where f x = T.pack $ show x
          g x = AesonEnc.text . T.pack $ show x

instance FromJSONKey (Hex Word256) where
    fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

data CallType = Create | Delete | Update deriving (Eq, Show, Generic, NFData, ToJSON, FromJSON)

data CallData = CallData
  { _callType    :: CallType
  , _sender      :: Address
  , _owner       :: Address
  , _gasPrice    :: Integer
  , _value       :: Integer
  , _input       :: ByteString
  , _output      :: Maybe ByteString
  } deriving (Eq, Show, Generic, NFData)
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
  { _codeHash     :: CodePtr
  , _codeKind     :: CodeKind
  , _storageDiffs :: BS.ActionDataDiff
  , _callData     :: [CallData]
  } deriving (Eq, Show, Generic, NFData)
makeLenses ''ActionData

instance ToJSON ActionData where
  toJSON ActionData{..} = object
    [ "codeHash" .= _codeHash
    , "codeKind" .= _codeKind
    , "diff"     .= _storageDiffs
    , "data"     .= _callData
    ]

instance FromJSON ActionData where
  parseJSON (Object o) = do
    ch <- o .: "codeHash"
    ck <- o .:? "codeKind" .!= EVM
    df <- (case ck of
      EVM -> explicitParseField BS.parseDiffEVM
      SolidVM -> explicitParseField BS.parseDiffSolidVM) o "diff"
    dt <- o .: "data"
    return $ ActionData ch ck df dt
  parseJSON o = error $ "parseJSON ActionData: Expected object, got: " ++ show o

data Action' = Action'
  { _blockHash          :: SHA
  , _blockTimestamp     :: UTCTime
  , _blockNumber        :: Integer
  , _transactionHash    :: SHA
  , _transactionChainId :: Maybe ChainId
  , _transactionSender  :: Address
  , _actionData         :: Map Address ActionData
  , _metadata           :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic, NFData)
makeLenses ''Action'

instance ToJSON Action' where
  toJSON Action'{..} = object
    [ "blockHash"       .= _blockHash
    , "blockTimestamp"  .= _blockTimestamp
    , "blockNumber"     .= _blockNumber
    , "transactionHash" .= _transactionHash
    , "chainId"         .= _transactionChainId
    , "sender"          .= _transactionSender
    , "data"            .= _actionData
    , "metadata"        .= _metadata
    ]

instance FromJSON Action' where
  parseJSON (Object o) = Action'
    <$> (o .: "blockHash")
    <*> (o .: "blockTimestamp")
    <*> (o .: "blockNumber")
    <*> (o .: "transactionHash")
    <*> (o .:? "chainId")
    <*> (o .: "sender")
    <*> (o .: "data")
    <*> (o .: "metadata")
  parseJSON o = error $ "parseJSON Action: Expected object, got: " ++ show o

data Action = Action
  { actionBlockHash      :: SHA
  , actionBlockTimestamp :: UTCTime
  , actionBlockNumber    :: Integer
  , actionTxHash         :: SHA
  , actionTxChainId      :: Maybe ChainId
  , actionTxSender       :: Address
  , actionAddress        :: Address
  , actionCodeHash       :: CodePtr
  , actionStorage        :: BS.ActionDataDiff
  , actionType           :: CallType
  , actionCallData       :: [CallData]
  , actionMetadata       :: Map Text Text
  } deriving (Show, Generic, NFData)

flatten :: Action' -> [Action]
flatten Action'{..} = flip map (M.toList _actionData) $
  \(address, ActionData{..}) ->
    let t = maybe Create _callType $ listToMaybe _callData -- It's a Create because I said so
     in Action
          { actionBlockHash      = _blockHash
          , actionBlockTimestamp = _blockTimestamp
          , actionBlockNumber    = _blockNumber
          , actionTxHash         = _transactionHash
          , actionTxChainId      = _transactionChainId
          , actionTxSender       = _transactionSender
          , actionAddress        = address
          , actionCodeHash       = _codeHash
          , actionStorage        = _storageDiffs
          , actionType           = t
          , actionCallData       = _callData
          , actionMetadata       = fromMaybe M.empty _metadata
          }

formatAction :: Action -> Text
formatAction Action{..} = T.concat
  [ tshow actionType
  , ", blockHash: "
  , tshow actionBlockHash
  , ", blockTimestamp: "
  , tshow actionBlockTimestamp
  , ", blockNumber: "
  , tshow actionBlockNumber
  , ", transactionHash: "
  , tshow actionTxHash
  , ", "
  , (case actionTxChainId of
       Nothing -> ""
       Just c -> T.concat ["in chain", tshow c])
  , " with address: "
  , tshow actionAddress
  , " with "
  , tshow (case actionStorage of
      BS.ActionEVMDiff m -> M.size m
      BS.ActionSolidVMDiff m -> M.size m)
  , " items\n"
  , "    codeHash = "
  , tshow actionCodeHash
  ]
  where tshow :: Show a => a -> Text
        tshow = T.pack . show
