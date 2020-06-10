{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.Strato23.API.Types
  ( module Strato.Strato23.API.Types
  , Address(..)
  ) where


import           Control.Lens                 ((&), (?~))
import           Crypto.Secp256k1
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types             hiding (fieldLabelModifier)
import qualified Data.ByteString              as B
import qualified Data.ByteString.Base16       as B16
import qualified Data.ByteString.Char8        as C8
import           Data.Maybe
import qualified Data.Text                    as T
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


instance ToJSON PubKey where
  toJSON = String . T.pack . C8.unpack . B16.encode . exportPubKey False


instance FromJSON PubKey where
  parseJSON (String str) = return $ fromMaybe (err) $ importPubKey $ fst $ B16.decode $ C8.pack $ T.unpack str
    where err = error $ "parseJSON for PubKey failed to read " ++ (T.unpack str)
  parseJSON x = error $ "parseJSON for PubKey: expected string, got " ++ (show x)

instance ToSchema PubKey where
  declareNamedSchema _  = return $ named "PublicKey" binarySchema



data MsgHash = MsgHash B.ByteString deriving (Eq, Show, Generic)

instance ToJSON MsgHash where
  toJSON (MsgHash bs) = object 
                        [ "msgHash" .= (T.pack $ C8.unpack $ B16.encode bs)]

instance FromJSON MsgHash where
  parseJSON (Object o) = do 
    hsh <- o .: "msgHash" 
    return $ MsgHash $ fst $ B16.decode $ C8.pack $ T.unpack hsh
  parseJSON x = error $ "parseJSON for MsgHash: expected object, got " ++ (show x)

instance ToSchema MsgHash where
  declareNamedSchema = const . pure $ named "MsgHash bytestring" binarySchema

data SignatureDetails = SignatureDetails {
    r :: Hex Word256
  , s :: Hex Word256
  , v :: Hex Word8
} deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)


instance ToSchema (Hex Word256) where
  declareNamedSchema = const . pure $ named "hex word256" binarySchema

instance ToSchema (Hex Word8) where
  declareNamedSchema = const . pure $ named "hex word8" binarySchema


data User = User
  { username :: T.Text
  , address :: Address
  } deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)
