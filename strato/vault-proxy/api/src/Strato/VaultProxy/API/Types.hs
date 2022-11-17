{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.VaultProxy.API.Types
  ( module Strato.VaultProxy.API.Types
  , Address(..)
  , Signature(..) -- TODO: remove, ideally
  , PublicKey(..) --       same
  , SharedKey(..) --       same
  , RawOauth(..)
  ) where

import           Control.Lens                 hiding ((.=))
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types             hiding (fieldLabelModifier)
import qualified Data.ByteString              as B
import qualified Data.ByteString.Base16       as B16
import qualified Data.ByteString.Char8        as C8
import           Data.Cache
import           Data.Scientific              as Scientific
import qualified Data.Text                    as T
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named)

import           GHC.Generics

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Secp256k1
import           Strato.VaultProxy.DataTypes
import qualified LabeledError


vaultWrapperSchemaOptions :: SchemaOptions
vaultWrapperSchemaOptions = defaultSchemaOptions {fieldLabelModifier = camelCase . dropFPrefix}


data AddressAndKey = AddressAndKey { unAddress :: Address, unPubKey :: PublicKey } deriving (Show, Generic)

instance ToJSON AddressAndKey where
  toJSON (AddressAndKey a k) = object
                              [ "status" .= ("success" :: T.Text) -- hey, don't blame me, this is part of the spec
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
  declareNamedSchema _ = return $
    NamedSchema (Just "AddressAndKey")
      ( mempty
        & type_ ?~ SwaggerString
        & example ?~ "address : 186aaf1491177570eab131275a678ded7cf8157f, pubkey : 04642f59c13697153aed4ebf469c31ede0b36551d7a253601a6cd1997dd53d0952e884aa07a71aecce9562b5954e62788990cd872eeff52477ff657933fadb51ea"
        & description ?~ "Ethereum address and public key")


data MsgHash = MsgHash B.ByteString deriving (Eq, Show, Generic)

instance ToJSON MsgHash where
  toJSON (MsgHash bs) = object 
                        [ "msgHash" .= (T.pack $ C8.unpack $ B16.encode bs)]

instance FromJSON MsgHash where
  parseJSON (Object o) = do 
    hsh <- o .: "msgHash" 
    return $ MsgHash $ LabeledError.b16Decode "FromJSON<MsgHash>" $ C8.pack $ T.unpack hsh
  parseJSON x = error $ "parseJSON for MsgHash: expected object, got " ++ (show x)

instance ToSchema MsgHash where
  declareNamedSchema = const . pure $ named "MsgHash bytestring" binarySchema

data User = User
  { username :: T.Text
  , address :: Address
  } deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)

data RawOauth = RawOauth {
    authorization_endpoint :: T.Text,
    token_endpoint :: T.Text --,
} deriving (Show, Generic, Eq)

instance FromJSON RawOauth where
  parseJSON (Object o) = do
    aue  <- o .: "authorization_endpoint"
    ton  <- o .: "token_endpoint"

    authend <- case aue of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"authorization_endpoint\", but got something different."
    tokend <- case ton of
        (String s) -> pure s
        (Object _) -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
        _          -> error $ "Expected a JSON String under the key \"token_endpoint\", but got something different."
    return $ RawOauth authend tokend 
  parseJSON wat = typeMismatch "Spec" wat

type VaultCache = Cache T.Text VaultToken
