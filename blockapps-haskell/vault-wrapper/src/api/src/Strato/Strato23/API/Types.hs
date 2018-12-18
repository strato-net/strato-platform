{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.Strato23.API.Types
  ( module BlockApps.Ethereum
  , vaultWrapperSchemaOptions
  , StatusAndAddress(..)
  ) where

import           BlockApps.Ethereum
import           Control.Lens           ((&), (?~), mapped)
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types       hiding (fieldLabelModifier)
import           Data.Text              (Text)
import           Data.Swagger
import           GHC.Generics

vaultWrapperSchemaOptions :: SchemaOptions
vaultWrapperSchemaOptions = defaultSchemaOptions {fieldLabelModifier = camelCase . dropFPrefix}

newtype StatusAndAddress = StatusAndAddress { unStatusAndAddress :: Address } deriving (Show, Generic)

instance ToJSON StatusAndAddress where
  toJSON (StatusAndAddress a) = object
                              [ "status" .= ("success" :: Text) -- hey, don't blame me, this is part of the spec
                              , "address" .= a
                              ]

instance FromJSON StatusAndAddress where
  parseJSON (Object o) = StatusAndAddress <$> (o .: "address")
  parseJSON o = error $ "parseJSON StatusAndAddress: expected object, but got " ++ show o

instance ToSchema StatusAndAddress where
  declareNamedSchema proxy = genericDeclareNamedSchema vaultWrapperSchemaOptions proxy
    & mapped.schema.description ?~ "Status and Address"
    & mapped.schema.example ?~ toJSON ex
    where ex = StatusAndAddress $ Address 0xdeadbeef
