{-# LANGUAGE DataKinds         #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.Strato23.API.Types where

import           BlockApps.Ethereum
import           Control.Lens                 ((&), (?~), mapped)
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types             hiding (fieldLabelModifier)
import           Data.LargeWord
import           Data.Text                    (Text)
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named)
import           Data.Word
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

data SignatureDetails = SignatureDetails {
    r :: Hex Word256
  , s :: Hex Word256
  , v :: Hex Word8
} deriving (Eq, Show, Generic)

data UserData = UserData {
  msgHash :: Hex Word256
} deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails

instance ToSchema SignatureDetails where

instance ToSchema (Hex Word256) where
  declareNamedSchema = const . pure $ named "hex word256" binarySchema

instance ToSchema (Hex Word8) where
  declareNamedSchema = const . pure $ named "hex word8" binarySchema

instance ToJSON UserData
instance FromJSON UserData
instance ToSchema UserData where
