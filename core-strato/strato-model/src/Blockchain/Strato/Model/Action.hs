{-# LANGUAGE DeriveAnyClass       #-}
{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE RecordWildCards      #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Model.Action where

import           Control.DeepSeq
import           Control.Lens                 hiding ((.=))
import           Control.Monad                (liftM2)
import           Data.Aeson
import           Data.Aeson.Types
import qualified Data.ByteString              as B
import           Data.Function                (on)
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import qualified Data.HashMap.Strict          as HM
import           Data.Text                    (Text)
import           Data.Time
import           GHC.Generics

import           Blockchain.MiscJSON()
import           Blockchain.SolidVM.Model
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord           (Word256, bytesToWord256)
import           Blockchain.Strato.Model.SHA

data CallType = Create | Delete | Update deriving (Eq, Show, Generic, NFData)

instance ToJSON CallType where
instance FromJSON CallType where

data CallData = CallData
  { _callDataType     :: CallType
  , _callDataSender   :: Address
  , _callDataOwner    :: Address
  , _callDataGasPrice :: Integer
  , _callDataValue    :: Integer
  , _callDataInput    :: B.ByteString
  , _callDataOutput   :: Maybe B.ByteString
  } deriving (Eq, Show, Generic, NFData)
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

emptyCallData :: CallData
emptyCallData = CallData
  { _callDataType     = Create
  , _callDataSender   = Address 0
  , _callDataOwner    = Address 0
  , _callDataGasPrice = 0
  , _callDataValue    = 0
  , _callDataInput    = B.empty
  , _callDataOutput   = Nothing
  }

data ActionDataDiff = ActionEVMDiff (Map Word256 Word256)
                    | ActionSolidVMDiff (Map B.ByteString B.ByteString)
                    deriving (Eq, Show, Generic, NFData)

instance ToJSON ActionDataDiff where
  toJSON (ActionEVMDiff m) = toJSON m
  toJSON (ActionSolidVMDiff m) = toJSON m

sequenceTuple :: Monad m => (m a, m b) -> m (a, b)
sequenceTuple = uncurry (liftM2 (,))

-- There is intentionally no FromJSON instance. The ToJSON encoding does not
-- have enough information to recover the original type, and it is expected
-- that a sibling of ActionDataDiff will have the information to determine
-- which parser to use.
parseDiffEVM :: Value -> Parser ActionDataDiff
parseDiffEVM (Object obs) = fmap (ActionEVMDiff . M.fromList)
                          . mapM (sequenceTuple . bimap (f.String) f)
                          $ HM.toList obs
  where f :: Value -> Parser Word256
        f = fmap bytesToWord256 . parseJSON
parseDiffEVM x = typeMismatch "ActionEVMDiff" x

parseDiffSolidVM :: Value -> Parser ActionDataDiff
parseDiffSolidVM (Object obs) = fmap (ActionSolidVMDiff . M.fromList)
                              . mapM (sequenceTuple . bimap (f.String) f)
                              $ HM.toList obs
  where f :: Value -> Parser B.ByteString
        f = parseJSON
parseDiffSolidVM x = typeMismatch "ActionSolidVMDiff" x

data ActionData = ActionData
  { _actionDataCodeHash     :: SHA
  , _actionDataCodeKind     :: CodeKind
  , _actionDataStorageDiffs :: ActionDataDiff
  , _actionDataCallData     :: [CallData]
  } deriving (Eq, Show, Generic, NFData)
makeLenses ''ActionData

mergeActionData :: ActionData -> ActionData -> ActionData
mergeActionData newData oldData =
  let diffs = case (_actionDataStorageDiffs newData, _actionDataStorageDiffs oldData) of
        (ActionEVMDiff n, ActionEVMDiff o) -> ActionEVMDiff $ n `M.union` o
        (ActionSolidVMDiff n, ActionSolidVMDiff o) -> ActionSolidVMDiff $ n `M.union` o
        _ -> error "mismatched action kinds at the same address"
      calls = ((++) `on` _actionDataCallData) oldData newData
   in ActionData (_actionDataCodeHash oldData) (_actionDataCodeKind oldData) diffs calls

instance ToJSON ActionData where
  toJSON ActionData{..} = object
    [ "codeHash" .= _actionDataCodeHash
    , "diff"     .= _actionDataStorageDiffs
    , "data"     .= _actionDataCallData
    , "codeKind" .= _actionDataCodeKind
    ]

instance FromJSON ActionData where
  parseJSON (Object o) = do
    ch <- o .: "codeHash"
    ck <- o .: "codeKind"
    df <- case ck of
      EVM -> explicitParseField parseDiffEVM o "diff"
      SolidVM -> explicitParseField parseDiffSolidVM o "diff"
    dt <- o .: "data"
    return $ ActionData ch ck df dt
  parseJSON o = error $ "parseJSON ActionData: Expected object, got: " ++ show o

instance FromJSONKey Address where
  fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

data Action = Action
  { _actionBlockHash          :: SHA
  , _actionBlockTimestamp     :: UTCTime
  , _actionBlockNumber        :: Integer
  , _actionTransactionHash    :: SHA
  , _actionTransactionChainId :: Maybe Word256
  , _actionTransactionSender  :: Address
  , _actionData               :: Map Address ActionData
  , _actionMetadata           :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic, NFData)
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
