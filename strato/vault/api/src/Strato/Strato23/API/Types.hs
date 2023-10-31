{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.Types
  ( module Strato.Strato23.API.Types,
    Address (..),
    Signature (..), -- TODO: remove, ideally
    PublicKey (..), --       same
    SharedKey (..), --       same
    Version (..),
  )
where

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Control.Lens ((&), (?~))
import Data.Aeson.Casing
import Data.Aeson.Casing.Internal (dropFPrefix)
import Data.Aeson.Types hiding (fieldLabelModifier)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.Swagger
import Data.Swagger.Internal.Schema (named)
import qualified Data.Text as T
import GHC.Generics
import qualified LabeledError

vaultWrapperSchemaOptions :: SchemaOptions
vaultWrapperSchemaOptions = defaultSchemaOptions {fieldLabelModifier = camelCase . dropFPrefix}

data Version = Version {version :: Int} deriving (Show, Eq, Generic, Ord)

instance ToJSON Version where
  toJSON (Version v) = object ["version" .= v]

instance FromJSON Version where
  parseJSON (Object o) = do
    v <- o .: "version"
    return $ Version v
  parseJSON o = error $ "parseJSON Version: expected object, but got " ++ show o

instance ToSchema Version where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Version")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ "{\"version\" : \"1\"}"
            & description ?~ "Check to see if vault server is alive, and version the vault is running. Contains an Int for the version number."
        )

data AddressAndKey = AddressAndKey {unAddress :: Address, unPubKey :: PublicKey} deriving (Show, Generic)

instance ToJSON AddressAndKey where
  toJSON (AddressAndKey a k) =
    object
      [ "status" .= ("success" :: T.Text), -- hey, don't blame me, this is part of the spec
        "address" .= a,
        "pubkey" .= k
      ]

instance FromJSON AddressAndKey where
  parseJSON (Object o) = do
    a <- o .: "address"
    k <- o .: "pubkey"
    return $ AddressAndKey a k
  parseJSON o = error $ "parseJSON AddressAndKey: expected object, but got " ++ show o

instance ToSchema AddressAndKey where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "AddressAndKey")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ "address : 186aaf1491177570eab131275a678ded7cf8157f, pubkey : 04642f59c13697153aed4ebf469c31ede0b36551d7a253601a6cd1997dd53d0952e884aa07a71aecce9562b5954e62788990cd872eeff52477ff657933fadb51ea"
            & description ?~ "Ethereum address and public key"
        )

data MsgHash = MsgHash B.ByteString deriving (Eq, Show, Generic)

instance ToJSON MsgHash where
  toJSON (MsgHash bs) =
    object
      ["msgHash" .= (T.pack $ C8.unpack $ B16.encode bs)]

instance FromJSON MsgHash where
  parseJSON (Object o) = do
    hsh <- o .: "msgHash"
    return $ MsgHash $ LabeledError.b16Decode "FromJSON<MsgHash>" $ C8.pack $ T.unpack hsh
  parseJSON x = error $ "parseJSON for MsgHash: expected object, got " ++ (show x)

instance ToSchema MsgHash where
  declareNamedSchema = const . pure $ named "MsgHash bytestring" binarySchema

data User = User
  { username :: T.Text,
    address :: Address
  }
  deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)

data User' = User'
  { username' :: T.Text,
    oauthProvider' :: T.Text,
    address' :: Address
  }
  deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)
