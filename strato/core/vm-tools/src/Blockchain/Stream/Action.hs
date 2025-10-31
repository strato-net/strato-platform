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
  newCodeCollections,
  events,
  delegatecalls,

  DataDiff(..),
  Delegatecall(..),

  ) where

import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Event
import Control.DeepSeq
import Control.Lens hiding ((.=))
import Data.Aeson
import Data.Binary
import qualified Data.ByteString.Char8 as BC
import Data.List
import Data.Map.Strict (Map)
import qualified Data.Map.Ordered as OMap
import qualified Data.Map.Strict as M
import qualified Data.Sequence as S
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics
import SolidVM.Model.CodeCollection (CodeCollection)
import SolidVM.Model.Storable hiding (toList)
import Test.QuickCheck.Instances ()
import Text.Format

import Data.Binary.Instances.Time ()

data DataDiff = SolidVMDiff (Map StoragePath BasicValue)
  deriving (Eq, Show, Generic, NFData)

instance Format DataDiff where
  format (SolidVMDiff vals) =
    "SolidVMDiff [" ++ intercalate ", " (map (\(k, v) -> "(" ++ BC.unpack (unparsePath k) ++ ", " ++ v ++ ")") (M.toList $ fmap format vals)) ++ "]"

instance Binary DataDiff

instance ToJSON DataDiff where

instance FromJSONKey DataDiff where
instance FromJSON DataDiff where

data Delegatecall = Delegatecall
  { _delegatecallStorageAddress :: Address,
    _delegatecallCodeAddress :: Address,
    _delegatecallOrganization :: Text,
    _delegatecallApplication :: Text,
    _delegatecallContractName :: Text
  }
  deriving (Eq, Show, Read, Generic, NFData)

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

