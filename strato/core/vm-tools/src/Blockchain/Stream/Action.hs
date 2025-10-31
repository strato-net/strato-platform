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

{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

module Blockchain.Stream.Action (
  Action(..),
  newCodeCollections,
  events,
  delegatecalls,

  ActionData(..),

  DataDiff(..),
  Delegatecall(..),

  ) where

import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Event
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
--import Data.Foldable
import Data.List
import Data.Map.Strict (Map)
import qualified Data.Map.Ordered as OMap
import qualified Data.Map.Strict as M
--import Data.Maybe
import qualified Data.Sequence as S
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics
import SolidVM.Model.CodeCollection (CodeCollection)
import SolidVM.Model.Storable hiding (toList)
import Test.QuickCheck.Instances ()
import Text.Format

import Data.Binary.Instances.Time ()

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
    _delegatecallOrganization :: Text,
    _delegatecallApplication :: Text,
    _delegatecallContractName :: Text
  }
  deriving (Eq, Show, Read, Generic, NFData)

--makeLenses ''Delegatecall

instance Format Delegatecall where
  format Delegatecall {..} =
    "delegatecallStorageAddress: " ++ format _delegatecallStorageAddress ++ "\n"
      ++ "delegatecallCodeAddress: "
      ++ format _delegatecallCodeAddress
      ++ "\n"
      ++ "delegatecallOrganization: "
      ++ T.unpack _delegatecallOrganization
      ++ "\n"
      ++ "delegatecallApplication: "
      ++ T.unpack _delegatecallApplication
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
        "application" .= _delegatecallApplication,
        "contractName" .= _delegatecallContractName
      ]

instance FromJSON Delegatecall where
  parseJSON (Object o) = do
    s <- o .: "storageAddress"
    c <- o .: "codeAddress"
    r <- o .: "organization"
    a <- o .: "application"
    n <- o .: "contractName"
    pure $ Delegatecall s c r a n
  parseJSON o = fail $ "parseJSON Delegatecall: Expected object, got: " ++ show o

data Action = Action
  { _newCodeCollections :: [(Text, CodeCollection)],
    _events :: S.Seq Event,
    _delegatecalls :: S.Seq Delegatecall
  }
  deriving (Eq, Show, Generic)
makeLenses ''Action

instance NFData Action

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
