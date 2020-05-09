{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.Strato23.API.Types
  ( module Strato.Strato23.API.Types
  , Address(..)
  ) where

import           Control.Lens                 ((&), (?~), mapped)
import           Crypto.HaskoinShim
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types             hiding (fieldLabelModifier)
import           Data.Text                    (Text) 
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named)
import           Data.Word
import           GHC.Generics

import           BlockApps.Ethereum
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord

vaultWrapperSchemaOptions :: SchemaOptions
vaultWrapperSchemaOptions = defaultSchemaOptions {fieldLabelModifier = camelCase . dropFPrefix}


data AddressAndKey = AddressAndKey { unAddress :: Address, unPubKey :: PubKey } deriving (Show, Generic)

instance ToJSON AddressAndKey where
  toJSON (AddressAndKey a k) = object
                              [ "status" .= ("success" :: Text) -- hey, don't blame me, this is part of the spec
                              , "address" .= a
                              , "pubkey" .= k 
                              ]

instance FromJSON AddressAndKey where
  parseJSON (Object o) = do 
    a <- o .: "address"
    k <- o .: "pubkey"
    return $ AddressAndKey a k 
  parseJSON o = error $ "parseJSON AddressAndKey: expected object, but got " ++ show o


instance ToSchema AddressAndKey where
  declareNamedSchema proxy = genericDeclareNamedSchema vaultWrapperSchemaOptions proxy
    & mapped.schema.description ?~ "Address and Key"
    & mapped.schema.example ?~ toJSON ex
    where ex = AddressAndKey (Address 0xdeadbeef) (PubKey $ makePubKey InfPoint)


--TODO: move to dedicated PubKey file
instance ToSchema PubKey where
  declareNamedSchema _  = return $ named "PublicKey" binarySchema

data SignatureDetails = SignatureDetails {
    r :: Hex Word256
  , s :: Hex Word256
  , v :: Hex Word8
} deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)

data UserData = UserData {
  msgHash :: Hex Word256
} deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)

instance ToSchema (Hex Word256) where
  declareNamedSchema = const . pure $ named "hex word256" binarySchema

instance ToSchema (Hex Word8) where
  declareNamedSchema = const . pure $ named "hex word8" binarySchema

data User = User
  { username :: Text
  , address :: Address
  } deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)
