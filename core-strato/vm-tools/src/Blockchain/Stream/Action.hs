{-# LANGUAGE DeriveAnyClass       #-}
{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE RecordWildCards      #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Stream.Action where

import           Control.DeepSeq
import           Control.Lens                 hiding ((.=))
import           Control.Monad                (liftM2)
import           Data.Aeson
import           Data.Aeson.Types
import qualified Data.ByteString              as B
import qualified Data.ByteString.Short        as BSS
import           Data.Foldable
import           Data.Function                (on)
import qualified Data.HashMap.Strict          as HM
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe
import           Data.Text                    (Text)
import qualified Data.Text                    as T
import           Data.Time
import qualified Data.Sequence                as S
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Arbitrary.Generic
import           Test.QuickCheck.Instances()

import           Blockchain.MiscJSON()
import           Blockchain.SolidVM.Model
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord (Word256, bytesToWord256)
import           Blockchain.Strato.Model.Event
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256

import qualified Text.Colors                  as CL
import           Text.Format
import           Text.Tools


data CallType = Create | Delete | Update deriving (Eq, Show, Generic, NFData)

instance ToJSON CallType where
instance FromJSON CallType where

data CallData = CallData
  { _callDataType     :: CallType
  , _callDataSender   :: Account
  , _callDataOwner    :: Account
  , _callDataGasPrice :: Integer
  , _callDataValue    :: Integer
  , _callDataInput    :: BSS.ShortByteString
  , _callDataOutput   :: Maybe BSS.ShortByteString
  } deriving (Eq, Show, Generic, NFData)
makeLenses ''CallData

instance Format CallData where
  format CallData{..} =
    "callDataType: " ++ show _callDataType ++ "\n"
    ++ "callDataSender: " ++ format _callDataSender ++ "\n"
    ++ "callDataOwner: " ++ format _callDataOwner ++ "\n"
    ++ "callDataGasPrice: " ++ show _callDataGasPrice ++ "\n"
    ++ "callDataValue: " ++ show _callDataValue ++ "\n"
    ++ "callDataInput: " ++ show _callDataInput ++ "\n"
    ++ "callDataOutput: " ++ show _callDataOutput ++ "\n"


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
  , _callDataSender   = Account (Address 0) Nothing
  , _callDataOwner    = Account (Address 0) Nothing
  , _callDataGasPrice = 0
  , _callDataValue    = 0
  , _callDataInput    = BSS.empty
  , _callDataOutput   = Nothing
  }

data DataDiff = EVMDiff (Map Word256 Word256)
              | SolidVMDiff (Map B.ByteString B.ByteString)
              deriving (Eq, Show, Generic, NFData)

instance ToJSON DataDiff where
  toJSON (EVMDiff m) = toJSON m
  toJSON (SolidVMDiff m) = toJSON m

sequenceTuple :: Monad m => (m a, m b) -> m (a, b)
sequenceTuple = uncurry (liftM2 (,))

-- There is intentionally no FromJSON instance. The ToJSON instance does
-- not have enough information to recover the original type, and it is
-- expected that a sibling of DataDiff will have the information to
-- determine with parser to use.
parseDiffEVM :: Value -> Parser DataDiff
parseDiffEVM (Object obs) = fmap (EVMDiff . M.fromList)
                          . mapM (sequenceTuple . bimap (f.String) f)
                          $ HM.toList obs
  where f :: Value -> Parser Word256
        f = fmap bytesToWord256 . parseJSON
parseDiffEVM x = typeMismatch "EVMDiff" x

parseDiffSolidVM :: Value -> Parser DataDiff
parseDiffSolidVM (Object obs) = fmap (SolidVMDiff . M.fromList)
                              . mapM (sequenceTuple . bimap (f.String) f)
                              $ HM.toList obs
  where f :: Value -> Parser B.ByteString
        f = parseJSON
parseDiffSolidVM x = typeMismatch "SolidVMDiff" x

data ActionData = ActionData
  { _actionDataCodeHash     :: CodePtr
  , _actionDataOrganization :: Text
  , _actionDataApplication  :: Text
  , _actionDataCodeKind     :: CodeKind
  , _actionDataStorageDiffs :: DataDiff
  , _actionDataCallTypes    :: [CallType]
  } deriving (Eq, Show, Generic, NFData)
makeLenses ''ActionData

instance Format ActionData where
  format ActionData{..} = 
    "actionDataCodeHash: " ++ format _actionDataCodeHash ++ "\n"
    ++ "actionDataOrganization: " ++ show _actionDataOrganization ++ "\n"
    ++ "actionDataApplication: " ++ T.unpack _actionDataApplication ++ "\n"
    ++ "actionDataCodeKind: " ++ show _actionDataCodeKind ++ "\n"
    ++ "actionDataStorageDiffs: " ++ show _actionDataStorageDiffs ++ "\n"
    ++ "actionDataCallTypes:\n" ++ tab (show _actionDataCallTypes)
  

mergeActionData :: ActionData -> ActionData -> ActionData
mergeActionData newData oldData =
  let diffs = case (_actionDataStorageDiffs newData, _actionDataStorageDiffs oldData) of
          (EVMDiff n, EVMDiff o) -> EVMDiff $ n <> o
          (SolidVMDiff n, SolidVMDiff o) -> SolidVMDiff $ n <> o
          _ -> error "mismatched action kinds at the same address"
      calls = ((++) `on` _actionDataCallTypes) oldData newData
   in ActionData (_actionDataCodeHash oldData) (_actionDataOrganization newData) (_actionDataApplication newData) (_actionDataCodeKind oldData) diffs calls

instance ToJSON ActionData where
  toJSON ActionData{..} = object
    [ "codeHash" .= _actionDataCodeHash
    , "organization" .= _actionDataOrganization
    , "application" .= _actionDataApplication
    , "diff"     .= _actionDataStorageDiffs
    , "types"     .= _actionDataCallTypes
    , "codeKind" .= _actionDataCodeKind
    ]

instance FromJSON ActionData where
  parseJSON (Object o) = do
    ch <- o .: "codeHash"
    og <- o .: "organization"
    ap <- o .: "application"
    ck <- o .:? "codeKind" .!= EVM
    df <- (case ck of
      EVM -> explicitParseField parseDiffEVM
      SolidVM -> explicitParseField parseDiffSolidVM) o "diff"
    dt <- o .: "types"
    return $ ActionData ch og ap ck df dt
  parseJSON o = error $ "parseJSON ActionData: Expected object, got: " ++ show o

data Action = Action
  { _blockHash          :: Keccak256
  , _blockTimestamp     :: UTCTime
  , _blockNumber        :: Integer
  , _transactionHash    :: Keccak256
  , _transactionChainId :: Maybe Word256
  , _transactionSender  :: Account
  , _actionData               :: Map Account ActionData
  , _metadata           :: Maybe (Map Text Text)
  , _events             :: S.Seq Event
  } deriving (Eq, Show, Generic, NFData)
makeLenses ''Action

instance Format Action where
  format Action{..} =
    "blockHash: " ++ format _blockHash ++ "\n"
    ++ "actionBlockTimestamp: " ++ show _blockTimestamp ++ "\n"
    ++ "actionBlockNumber: " ++ show _blockNumber ++ "\n"
    ++ "actionTransactionHash: " ++ format _transactionHash ++ "\n"
    ++ "actionTransactionChainId: " ++ format _transactionChainId ++ "\n"
    ++ "actionTransactionSender: " ++ format _transactionSender ++ "\n"
    ++ "actionData:\n" ++ unlines (map (\(k, v) -> tab $ format k ++ ":\n" ++ (tab $ format v)) $ M.toList _actionData) ++ "\n"
    ++ "actionMetadata: " ++ unwords (map (\(k, v) -> "(" ++ CL.blue (show k) ++ ": " ++ show (shorten 30 $ T.unpack v) ++ ")") $ M.toList $ fromMaybe M.empty $ _metadata) ++ "\n"
    ++ "actionEvents: " ++ unlines (map show $ toList _events) ++ "\n"

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
    , "events"          .= _events
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
    <*> (o .: "events")
  parseJSON o = error $ "parseJSON Action: Expected object, got: " ++ show o

instance Arbitrary CallType where
  arbitrary = genericArbitrary

instance Arbitrary CallData where
  arbitrary = genericArbitrary

instance Arbitrary DataDiff where
  arbitrary = genericArbitrary

instance Arbitrary ActionData where
  arbitrary = genericArbitrary

instance Arbitrary Action where
  arbitrary = genericArbitrary
  
