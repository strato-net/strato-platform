{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE RankNTypes #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Stream.Action where

-- import qualified Data.HashMap.Strict          as HM

import Blockchain.MiscJSON ()
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.ExtendedWord (Word256, bytesToWord256)
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Control.Lens hiding ((.=))
import Control.Monad (liftM2)
import Data.Aeson
import qualified Data.Aeson.Key as DAK
import qualified Data.Aeson.KeyMap as KM
import Data.Aeson.Types
import Data.Binary
import qualified Data.Bifunctor as BF
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Short as BSS
import Data.Foldable
import Data.Function (on)
import Data.List
import Data.Map.Strict (Map)
import qualified Data.Map.Ordered as OMap
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Sequence as S
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time
import GHC.Generics
import SolidVM.Model.CodeCollection (CodeCollection)
import SolidVM.Model.Storable hiding (toList)
import Test.QuickCheck
import Test.QuickCheck.Arbitrary.Generic
import Test.QuickCheck.Instances ()
import qualified Text.Colors as CL
import Text.Format
import Text.Tools

import Data.Binary.Instances.Time ()

data CallType = Create | Delete | Update deriving (Eq, Show, Generic, NFData)

instance Binary CallType

instance ToJSON CallType

instance FromJSON CallType

data CallData = CallData
  { _callDataType :: CallType,
    _callDataSender :: Account,
    _callDataOwner :: Account,
    _callDataGasPrice :: Integer,
    _callDataValue :: Integer,
    _callDataInput :: BSS.ShortByteString,
    _callDataOutput :: Maybe BSS.ShortByteString
  }
  deriving (Eq, Show, Generic, NFData)

makeLenses ''CallData

instance Format CallData where
  format CallData {..} =
    "callDataType: " ++ show _callDataType ++ "\n"
      ++ "callDataSender: "
      ++ format _callDataSender
      ++ "\n"
      ++ "callDataOwner: "
      ++ format _callDataOwner
      ++ "\n"
      ++ "callDataGasPrice: "
      ++ show _callDataGasPrice
      ++ "\n"
      ++ "callDataValue: "
      ++ show _callDataValue
      ++ "\n"
      ++ "callDataInput: "
      ++ show _callDataInput
      ++ "\n"
      ++ "callDataOutput: "
      ++ show _callDataOutput
      ++ "\n"

instance ToJSON CallData where
  toJSON CallData {..} =
    object
      [ "type" .= _callDataType,
        "sender" .= _callDataSender,
        "owner" .= _callDataOwner,
        "gasPrice" .= _callDataGasPrice,
        "value" .= _callDataValue,
        "input" .= _callDataInput,
        "output" .= _callDataOutput
      ]

instance FromJSON CallData where
  parseJSON (Object o) =
    CallData
      <$> (o .: "type")
      <*> (o .: "sender")
      <*> (o .: "owner")
      <*> (o .: "gasPrice")
      <*> (o .: "value")
      <*> (o .: "input")
      <*> (o .:? "output")
  parseJSON o = fail $ "parseJSON CallData: Expected object, got: " ++ show o

emptyCallData :: CallData
emptyCallData =
  CallData
    { _callDataType = Create,
      _callDataSender = Account (Address 0) Nothing,
      _callDataOwner = Account (Address 0) Nothing,
      _callDataGasPrice = 0,
      _callDataValue = 0,
      _callDataInput = BSS.empty,
      _callDataOutput = Nothing
    }

omapLens :: (Ord k) => k -> Lens' (OMap.OMap k v) (Maybe v)
omapLens k = lens getter setter
  where
    getter omap = OMap.lookup k omap
    setter omap newValue = OMap.alter (const newValue) k omap

omapInsertWith ::
  Ord k =>
  (a -> a -> a)  -- ^ Function to combine the new value with the old value.
  -> k           -- ^ Key.
  -> a           -- ^ New value.
  -> OMap.OMap k a  -- ^ Map to insert into.
  -> OMap.OMap k a  -- ^ Resulting map.
omapInsertWith f k x omap =
  OMap.alter (Just . maybe x (f x)) k omap

-- | Adjust a value at a specific key in an OMap.
-- If the key is present, apply the function to the value.
-- If the key is not present, return the original OMap.
omapAdjust :: Ord k => (a -> a) -> k -> OMap.OMap k a -> OMap.OMap k a
omapAdjust f k omap = omapAdjustWithKey (const f) k omap

-- | Adjust a value at a specific key in an OMap using a key-dependent function.
-- If the key is present, apply the function to the key and the value.
-- If the key is not present, return the original OMap.
omapAdjustWithKey :: Ord k => (k -> a -> a) -> k -> OMap.OMap k a -> OMap.OMap k a
omapAdjustWithKey f k omap = OMap.alter (fmap (f k)) k omap

-- | Take the union of two ordered maps. If a key appears in both maps,
-- the first argument's index takes precedence, and the supplied function
-- is used to combine the values.
omapUnionWith :: Ord k => (v -> v -> v) -> OMap.OMap k v -> OMap.OMap k v -> OMap.OMap k v
omapUnionWith f = omapUnionWithKey (\_ x y -> f x y)

-- | Take the union of two ordered maps using a key-dependent combine function.
-- If a key appears in both maps, the first argument's index takes precedence.
omapUnionWithKey :: Ord k => (k -> v -> v -> v) -> OMap.OMap k v -> OMap.OMap k v -> OMap.OMap k v
omapUnionWithKey f t1 t2 = OMap.unionWithL f t1 t2

omapMap :: Ord k => (a -> b) -> OMap.OMap k a -> OMap.OMap k b
omapMap f omap = OMap.fromList $ map (\(k, a) -> (k, f a)) $ OMap.assocs omap

data DataDiff
  = EVMDiff (Map Word256 Word256)
  | SolidVMDiff (Map B.ByteString B.ByteString)
  deriving (Eq, Show, Generic, NFData)

instance Format DataDiff where
  format x@(EVMDiff _) = show x
  format (SolidVMDiff vals) =
    let formatVal (Left e) = "Error: " ++ show e
        formatVal (Right v) = format v
     in "SolidVMDiff [" ++ intercalate ", " (map (\(k, v) -> "(" ++ BC.unpack k ++ ", " ++ v ++ ")") (M.toList $ fmap (formatVal . hexStorageToBasic . HexStorage) vals)) ++ "]"

instance Binary DataDiff

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
parseDiffEVM (Object obs) =
  fmap (EVMDiff . M.fromList)
    . mapM (sequenceTuple . bimap (f . String) f)
    $ BF.first DAK.toText <$> KM.toList obs
  where
    f :: Value -> Parser Word256
    f = fmap bytesToWord256 . parseJSON
parseDiffEVM x = typeMismatch "EVMDiff" x

parseDiffSolidVM :: Value -> Parser DataDiff
parseDiffSolidVM (Object obs) =
  fmap (SolidVMDiff . M.fromList)
    . mapM (sequenceTuple . bimap (f . String) f)
    $ BF.first DAK.toText <$> KM.toList obs
  where
    f :: Value -> Parser B.ByteString
    f = parseJSON
parseDiffSolidVM x = typeMismatch "SolidVMDiff" x

data ActionData = ActionData
  { _actionDataCodeHash :: CodePtr,
    _actionDataCodeCollection :: CodeCollection,
    _actionDataCreator :: Text,
    _actionDataCCCreator :: Maybe Text,
    _actionDataRoot :: Text,
    _actionDataApplication :: Text,
    _actionDataCodeKind :: CodeKind,
    _actionDataStorageDiffs :: DataDiff,
    _actionDataAbstracts :: Map (Account, Text) (Text, Text, [Text]), -- (import address, contract name) -> (cn, app)
    _actionDataMappings :: [Text],
    _actionDataArrays :: [Text],
    _actionDataCallTypes :: [CallType]
  }
  deriving (Eq, Show, Generic, NFData)

makeLenses ''ActionData

instance Format ActionData where
  format ActionData {..} =
    "actionDataCodeHash: " ++ format _actionDataCodeHash ++ "\n"
      ++ "actionDataCreator: "
      ++ T.unpack _actionDataCreator
      ++ "\n"
      ++ "actionDataCCCreator: "
      ++ maybe "Nothing" T.unpack _actionDataCCCreator
      ++ "\n"
      ++ "actionDataRoot: "
      ++ T.unpack _actionDataRoot
      ++ "\n"
      ++ "actionDataApplication: "
      ++ T.unpack _actionDataApplication
      ++ "\n"
      ++ "actionDataCodeKind: "
      ++ show _actionDataCodeKind
      ++ "\n"
      ++ "actionDataStorageDiffs: "
      ++ format _actionDataStorageDiffs
      ++ "\n"
      ++ "actionDataCallTypes:\n"
      ++ tab (show _actionDataCallTypes)

instance Binary ActionData

mergeActionData :: ActionData -> ActionData -> ActionData
mergeActionData newData oldData =
  let diffs = case (_actionDataStorageDiffs newData, _actionDataStorageDiffs oldData) of
        (EVMDiff n, EVMDiff o) -> EVMDiff $ n <> o
        (SolidVMDiff n, SolidVMDiff o) -> SolidVMDiff $ n <> o
        _ -> error "mismatched action kinds at the same address"
      calls = ((++) `on` _actionDataCallTypes) oldData newData
      cc = _actionDataCodeCollection oldData <> _actionDataCodeCollection newData
      abstracts = _actionDataAbstracts oldData <> _actionDataAbstracts newData
      mappings = nub $ _actionDataMappings oldData ++ _actionDataMappings newData
      arrays = nub $ _actionDataArrays oldData ++ _actionDataArrays newData
   in ActionData (_actionDataCodeHash oldData) cc (_actionDataCreator newData) (_actionDataCCCreator newData) (_actionDataRoot newData) (_actionDataApplication newData) (_actionDataCodeKind oldData) diffs abstracts mappings arrays calls

instance ToJSON ActionData where
  toJSON ActionData {..} =
    object
      [ "codeHash" .= _actionDataCodeHash,
        "codeCollection" .= _actionDataCodeCollection,
        "creator" .= _actionDataCreator,
        "cc_creator" .= _actionDataCCCreator,
        "root" .= _actionDataRoot,
        "application" .= _actionDataApplication,
        "diff" .= _actionDataStorageDiffs,
        "abstracts" .= _actionDataAbstracts,
        "mappings" .= _actionDataMappings,
        "arrays" .= _actionDataArrays,
        "types" .= _actionDataCallTypes,
        "codeKind" .= _actionDataCodeKind
      ]

instance FromJSON ActionData where
  parseJSON (Object o) = do
    ch <- o .: "codeHash"
    cc <- o .: "codeCollection"
    cr <- o .: "creator"
    ccr <- o .: "cc_creator"
    rt <- o .: "root"
    ap <- o .: "application"
    ck <- o .:? "codeKind" .!= EVM
    df <-
      ( case ck of
          EVM -> explicitParseField parseDiffEVM
          SolidVM -> explicitParseField parseDiffSolidVM
        )
        o
        "diff"
    da <- o .: "abstracts"
    dm <- o .: "mappings"
    dr <- o .: "arrays"
    dt <- o .: "types"
    return $ ActionData ch cc cr ccr rt ap ck df da dm dr dt
  parseJSON o = fail $ "parseJSON ActionData: Expected object, got: " ++ show o

data Delegatecall = Delegatecall
  { _delegatecallStorageAccount :: Account,
    _delegatecallCodeAccount :: Account,
    _delegatecallOrganization :: Text,
    _delegatecallApplication :: Text
  }
  deriving (Eq, Show, Generic, NFData)

makeLenses ''Delegatecall

instance Format Delegatecall where
  format Delegatecall {..} =
    "delegatecallStorageAccount: " ++ format _delegatecallStorageAccount ++ "\n"
      ++ "delegatecallCodeAccount: "
      ++ format _delegatecallCodeAccount
      ++ "\n"
      ++ "delegatecallOrganization: "
      ++ T.unpack _delegatecallOrganization
      ++ "\n"
      ++ "delegatecallApplication: "
      ++ T.unpack _delegatecallApplication

instance Binary Delegatecall

instance ToJSON Delegatecall where
  toJSON Delegatecall {..} =
    object
      [ "storageAccount" .= _delegatecallStorageAccount,
        "codeAccount" .= _delegatecallCodeAccount,
        "organization" .= _delegatecallOrganization,
        "application" .= _delegatecallApplication
      ]

instance FromJSON Delegatecall where
  parseJSON (Object o) = do
    s <- o .: "storageAccount"
    c <- o .: "codeAccount"
    r <- o .: "organization"
    a <- o .: "application"
    pure $ Delegatecall s c r a
  parseJSON o = fail $ "parseJSON Delegatecall: Expected object, got: " ++ show o

data Action = Action
  { _blockHash :: Keccak256,
    _blockTimestamp :: UTCTime,
    _blockNumber :: Integer,
    _transactionHash :: Keccak256,
    _transactionChainId :: Maybe Word256,
    _transactionSender :: Account,
    _actionData :: OMap.OMap Account ActionData,
    _metadata :: Maybe (Map Text Text),
    _events :: S.Seq Event,
    _delegatecalls :: S.Seq Delegatecall
  }
  deriving (Eq, Show, Generic)
makeLenses ''Action

instance (NFData k, NFData v) => NFData (OMap.OMap k v) where
    rnf omap = rnf (OMap.assocs omap) -- Convert OMap to list and apply rnf

instance NFData Action

instance Format Action where
  format Action {..} =
    "blockHash: " ++ format _blockHash ++ "\n"
      ++ "actionBlockTimestamp: "
      ++ show _blockTimestamp
      ++ "\n"
      ++ "actionBlockNumber: "
      ++ show _blockNumber
      ++ "\n"
      ++ "actionTransactionHash: "
      ++ format _transactionHash
      ++ "\n"
      ++ "actionTransactionChainId: "
      ++ format _transactionChainId
      ++ "\n"
      ++ "actionTransactionSender: "
      ++ format _transactionSender
      ++ "\n"
      ++ "actionData:\n"
      ++ unlines (map (\(k, v) -> tab $ format k ++ ":\n" ++ (tab $ format v)) $ OMap.assocs _actionData)
      ++ "\n"
      ++ "actionMetadata: "
      ++ unwords (map (\(k, v) -> "(" ++ CL.blue (show k) ++ ": " ++ show (shorten 30 $ T.unpack v) ++ ")") $ M.toList $ fromMaybe M.empty $ _metadata)
      ++ "\n"
      ++ "actionEvents: "
      ++ unlines (map show $ toList _events)
      ++ "\n"
      ++ "actionDelegatecalls: "
      ++ unlines (map show $ toList _delegatecalls)
      ++ "\n"

instance Binary Action

instance (Ord k, Binary k, Binary v) => Binary (OMap.OMap k v) where
    put omap = put (OMap.assocs omap) -- Serialize OMap as list of key-value pairs
    get = do
        kvPairs <- get -- Deserialize a list of key-value pairs
        return $ OMap.fromList kvPairs -- Convert list back to OMap

instance (ToJSON k, ToJSON v) => ToJSON (OMap.OMap k v) where
    toJSON omap = object [ "omapData" .= OMap.assocs omap ]

instance (Ord k, FromJSON k, FromJSON v) => FromJSON (OMap.OMap k v) where
    parseJSON = withObject "OMap" $ \obj -> do
        omapData <- obj .: "omapData"
        return $ OMap.fromList omapData

instance ToJSON Action where
  toJSON Action {..} =
    object
      [ "blockHash" .= _blockHash,
        "blockTimestamp" .= _blockTimestamp,
        "blockNumber" .= _blockNumber,
        "transactionHash" .= _transactionHash,
        "chainId" .= _transactionChainId,
        "sender" .= _transactionSender,
        "data" .= _actionData,
        "metadata" .= _metadata,
        "events" .= _events,
        "delegatecalls" .= _delegatecalls
      ]

instance FromJSON Action where
  parseJSON (Object o) =
    Action
      <$> (o .: "blockHash")
      <*> (o .: "blockTimestamp")
      <*> (o .: "blockNumber")
      <*> (o .: "transactionHash")
      <*> (o .:? "chainId")
      <*> (o .: "sender")
      <*> (o .: "data")
      <*> (o .: "metadata")
      <*> (o .: "events")
      <*> (fromMaybe S.empty <$> (o .:? "delegatecalls"))
  parseJSON o = fail $ "parseJSON Action: Expected object, got: " ++ show o

instance Arbitrary CallType where
  arbitrary = genericArbitrary

instance Arbitrary CallData where
  arbitrary = genericArbitrary

instance Arbitrary DataDiff where
  arbitrary = genericArbitrary

instance Arbitrary ActionData where
  arbitrary = genericArbitrary

instance Arbitrary Delegatecall where
  arbitrary = genericArbitrary

instance Arbitrary Action where
  arbitrary = genericArbitrary

instance (Ord k, Arbitrary k, Arbitrary v) => Arbitrary (OMap.OMap k v) where
    arbitrary = do
        kvPairs <- listOf arbitrary -- Generate a list of key-value pairs
        return $ OMap.fromList kvPairs -- Convert list to OMap