{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE RankNTypes #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Stream.Action (
  Action(..),
  blockHash,
  blockTimestamp,
  blockNumber,
  transactionSender,
  actionData,
  newCodeCollections,
  events,
  delegatecalls,

  ActionData(..),
  actionDataStorageDiffs,

  DataDiff(..),
  Delegatecall(..),

  omapAdjust,
  omapInsertWith,
  omapLens,
  omapMap,
--  omapUnionWith,
  mergeActionData,
  mergeActionDataStorageDiffs

  ) where

import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Event
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
import qualified Data.ByteString.Char8 as BC
import Data.Foldable
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
import Test.QuickCheck.Instances ()
import Text.Format
import Text.Tools

import Data.Binary.Instances.Time ()

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
{-
-- | Take the union of two ordered maps. If a key appears in both maps,
-- the first argument's index takes precedence, and the supplied function
-- is used to combine the values.
omapUnionWith :: Ord k => (v -> v -> v) -> OMap.OMap k v -> OMap.OMap k v -> OMap.OMap k v
omapUnionWith f = omapUnionWithKey (\_ x y -> f x y)

-- | Take the union of two ordered maps using a key-dependent combine function.
-- If a key appears in both maps, the first argument's index takes precedence.
omapUnionWithKey :: Ord k => (k -> v -> v -> v) -> OMap.OMap k v -> OMap.OMap k v -> OMap.OMap k v
omapUnionWithKey f t1 t2 = OMap.unionWithL f t1 t2
-}
omapMap :: Ord k => (a -> b) -> OMap.OMap k a -> OMap.OMap k b
omapMap f omap = OMap.fromList $ map (\(k, a) -> (k, f a)) $ OMap.assocs omap

data DataDiff
  = SolidVMDiff (Map StoragePath BasicValue)
  deriving (Eq, Show, Generic, NFData)

instance Format DataDiff where
  format (SolidVMDiff vals) =
    "SolidVMDiff [" ++ intercalate ", " (map (\(k, v) -> "(" ++ BC.unpack (unparsePath k) ++ ", " ++ v ++ ")") (M.toList $ fmap format vals)) ++ "]"

instance Binary DataDiff

instance ToJSON DataDiff where
  toJSON (SolidVMDiff m) = toJSON m

sequenceTuple :: Monad m => (m a, m b) -> m (a, b)
sequenceTuple = uncurry (liftM2 (,))

parseDiffSolidVM :: Value -> Parser DataDiff
parseDiffSolidVM (Object obs) =
  fmap (SolidVMDiff . M.fromList)
    . mapM (sequenceTuple . bimap (f . String) parseJSON)
    $ BF.first DAK.toText <$> KM.toList obs
  where
    f :: Value -> Parser StoragePath
    f = parseJSON
parseDiffSolidVM x = typeMismatch "SolidVMDiff" x

data ActionData = ActionData
  { _actionDataStorageDiffs :: DataDiff
  }
  deriving (Eq, Show, Generic, NFData)

makeLenses ''ActionData

instance Format ActionData where
  format ActionData {..} =
    "actionDataStorageDiffs: " ++ format _actionDataStorageDiffs

instance Binary ActionData

mergeActionData :: ActionData -> ActionData -> ActionData
mergeActionData newData oldData =
  let SolidVMDiff n = _actionDataStorageDiffs newData
      SolidVMDiff o = _actionDataStorageDiffs oldData
   in ActionData
          (SolidVMDiff $ n <> o)

mergeActionDataStorageDiffs :: ActionData -> ActionData -> ActionData
mergeActionDataStorageDiffs newData oldData =
  let SolidVMDiff n = _actionDataStorageDiffs newData
      SolidVMDiff o = _actionDataStorageDiffs oldData
      diffs = SolidVMDiff $ n <> o
   in newData & actionDataStorageDiffs .~ diffs

instance Semigroup ActionData where
  (<>) = mergeActionData

instance ToJSON ActionData where
  toJSON ActionData {..} =
    object
      [ "diff" .= _actionDataStorageDiffs
      ]

instance FromJSON ActionData where
  parseJSON (Object o) = do
    df <- explicitParseField parseDiffSolidVM o "diff"
    return $ ActionData df
  parseJSON o = fail $ "parseJSON ActionData: Expected object, got: " ++ show o

data Delegatecall = Delegatecall
  { _delegatecallStorageAddress :: Address,
    _delegatecallCodeAddress :: Address,
    _delegatecallOrganization :: Maybe Text,
    _delegatecallContractName :: Text
  }
  deriving (Eq, Ord, Show, Read, Generic, NFData)

--makeLenses ''Delegatecall

instance Format Delegatecall where
  format Delegatecall {..} =
    "delegatecallStorageAddress: " ++ format _delegatecallStorageAddress ++ "\n"
      ++ "delegatecallCodeAddress: "
      ++ format _delegatecallCodeAddress
      ++ "\n"
      ++ "delegatecallOrganization: "
      ++ T.unpack (fromMaybe "<none>" _delegatecallOrganization)
      ++ "\n"
      ++ "delegatecallContractName: "
      ++ T.unpack _delegatecallContractName

instance Binary Delegatecall

instance ToJSON Delegatecall where
  toJSON Delegatecall {..} =
    object
      [ "storageAddress" .= _delegatecallStorageAddress,
        "codeAddress" .= _delegatecallCodeAddress,
        "organization" .= _delegatecallOrganization,
        "contractName" .= _delegatecallContractName
      ]

instance FromJSON Delegatecall where
  parseJSON (Object o) = do
    s <- o .: "storageAddress"
    c <- o .: "codeAddress"
    r <- o .: "organization"
    n <- o .: "contractName"
    pure $ Delegatecall s c r n
  parseJSON o = fail $ "parseJSON Delegatecall: Expected object, got: " ++ show o

data Action = Action
  { _blockHash :: Keccak256,
    _blockTimestamp :: UTCTime,
    _blockNumber :: Integer,
    _transactionSender :: Address,
    _actionData :: OMap.OMap Address ActionData,
    _newCodeCollections :: OMap.OMap (Text, Keccak256) CodeCollection,
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
      ++ "actionTransactionSender: "
      ++ format _transactionSender
      ++ "\n"
      ++ "actionData:\n"
      ++ unlines (map (\(k, v) -> tab $ format k ++ ":\n" ++ (tab $ format v)) $ OMap.assocs _actionData)
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
        "sender" .= _transactionSender,
        "data" .= _actionData,
        "newCodeCollections" .= _newCodeCollections,
        "events" .= _events,
        "delegatecalls" .= _delegatecalls
      ]

instance FromJSON Action where
  parseJSON (Object o) =
    Action
      <$> (o .: "blockHash")
      <*> (o .: "blockTimestamp")
      <*> (o .: "blockNumber")
      <*> (o .: "sender")
      <*> (o .: "data")
      <*> (o .: "newCodeCollections")
      <*> (o .: "events")
      <*> (fromMaybe S.empty <$> (o .:? "delegatecalls"))
  parseJSON o = fail $ "parseJSON Action: Expected object, got: " ++ show o

{-
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
-}
