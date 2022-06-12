{-# LANGUAGE DeriveAnyClass        #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeSynonymInstances  #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

--{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

module BlockApps.Strato.Types
  (
    Storage (..)
  , StorageKV (..)
  ) where

import           Control.Monad
import           Data.Aeson
import           Data.Aeson.Types
import           Data.Swagger
import qualified Data.Text                    as Text
import           GHC.Generics
import           Servant.API
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()
import           Text.Read
-- TODO: Unify Bloch and Strato transactions
import           BlockApps.Bloc22.API.TypeWrappers
import           Blockchain.SolidVM.Model
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.ExtendedWord

instance (ToHttpApiData a) => ToHttpApiData [a] where
  toUrlPiece = Text.pack . show . map toUrlPiece

instance FromHttpApiData Word256 where
  parseUrlPiece text = case readMaybe (Text.unpack text) of
    Nothing      -> Left $ "Could not decode Word256: " <> text
    Just (Hex w256) -> Right w256

data StorageKV = EVMEntry (Hex Word256) (Hex Word256)
               | SolidVMEntry HexStorage HexStorage
               deriving (Eq, Show, Generic, ToSchema)

instance Arbitrary StorageKV where
  arbitrary = liftM2 EVMEntry arbitrary arbitrary

data Storage = Storage
  { storageAddress :: Address
  , storageKV      :: StorageKV
  , storageChainId :: Maybe ChainId
  , storageKind    :: CodeKind
  } deriving (Eq, Show, Generic, ToSchema)

instance FromJSON Storage where
  parseJSON (Object o) = do
    addr <- o .: "address"
    chain <- o .:? "chain_id"
    codeKind <- o .:? "kind" .!= EVM
    kv <- case codeKind of
      EVM -> liftM2 EVMEntry (o .: "key") (o .: "value")
      SolidVM -> liftM2 SolidVMEntry (o .: "key") (o .: "value")
    return $ Storage addr kv chain codeKind
  parseJSON x = typeMismatch "Storage" x

instance ToJSON Storage where
  toJSON Storage{..} =
    let (t, k, v) =
          case storageKV of
              EVMEntry k' v' -> ("kind" .= EVM, "key" .= k', "value" .= v')
              SolidVMEntry k' v' -> ("kind" .= SolidVM, "key" .= k', "value" .= v')
        a = "address" .= storageAddress
        c_id = case storageChainId of
                  Nothing -> []
                  Just c_id' -> ["chain_id" .= c_id']
    in object $ a:t:k:v:c_id

