{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.Strato23.API.Types
  ( module Strato.Strato23.API.Types
  , Address(..)
  , Signature(..) -- TODO: remove, ideally
  , PublicKey(..) --       same
  , SharedKey(..) --       same
  ) where


import           Control.Lens                 ((&), (?~), mapped)
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types             hiding (fieldLabelModifier)
import qualified Data.ByteString              as B
import qualified Data.ByteString.Base16       as B16
import qualified Data.ByteString.Char8        as C8
import           Data.Either
import qualified Data.Text                    as T
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named)

import           GHC.Generics

import           BlockApps.X509.Certificate
import           BlockApps.X509.Keys
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Secp256k1
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


data CreateCertEndpoint =
  CreateCertEndpoint
  { subject           :: Subject
  , parentCertificate :: Maybe X509Certificate
  } deriving (Generic, FromJSON, ToJSON)

instance ToSchema CreateCertEndpoint where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "Create a Certificate"
    & mapped.schema.description ?~ "A subject and a parent certificate"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: CreateCertEndpoint
      ex = CreateCertEndpoint
        { subject = Subject
          { subCommonName = "Luke Tollefson"
          , subOrg        = "BlockApps"
          , subUnit       = Just "Engineering"
          , subCountry    = Just "USA"
          , subPub        = fromRight (error "What!?!? 😱") $ bsToPub $ C8.pack $ unlines 
              [ "-----BEGIN PUBLIC KEY-----"
              , "MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEsTzyoLBtDSbtLTcCHyCjqwp2yoAOT3jL"
              , "iHo5uPBlyj4H+E4LW94TjMBfj0FPbxbcQvIBGyr/2i59FPhL0uBdZw=="
              , "-----END PUBLIC KEY-----"
              ]
          }
        , parentCertificate = either (const Nothing) Just . bsToCert . C8.pack $ unlines
            [ "-----BEGIN CERTIFICATE-----"
            , "MIIBjDCCATCgAwIBAgIRAIs9fXiIfXIZ22paA1BYggYwDAYIKoZIzj0EAwIFADBH"
            , "MQ0wCwYDVQQDDARMdWtlMRIwEAYDVQQKDAlCbG9ja2FwcHMxFDASBgNVBAsMC2Vu"
            , "Z2luZWVyaW5nMQwwCgYDVQQGDANVU0EwHhcNMjIwODIzMjAwODQxWhcNMjMwODIz"
            , "MjAwODQxWjBHMQ0wCwYDVQQDDARMdWtlMRIwEAYDVQQKDAlCbG9ja2FwcHMxFDAS"
            , "BgNVBAsMC2VuZ2luZWVyaW5nMQwwCgYDVQQGDANVU0EwVjAQBgcqhkjOPQIBBgUr"
            , "gQQACgNCAASxPPKgsG0NJu0tNwIfIKOrCnbKgA5PeMuIejm48GXKPgf4Tgtb3hOM"
            , "wF+PQU9vFtxC8gEbKv/aLn0U+EvS4F1nMAwGCCqGSM49BAMCBQADSAAwRQIhAPkX"
            , "DGxjCRln4lpSC5DtEGNKkepfkeNuyWzHcBCRyb2KAiAtIUIWWBO3qpCsVILHiD1T"
            , "56hQTEUFjrewBNx+JTQavA=="
            , "-----END CERTIFICATE-----"
            , "-----BEGIN CERTIFICATE-----"
            , "MIIBizCCAS+gAwIBAgIQahwA5iOvvZh0/1f2zxtxDjAMBggqhkjOPQQDAgUAMEcx"
            , "DTALBgNVBAMMBEx1a2UxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIGA1UECwwLZW5n"
            , "aW5lZXJpbmcxDDAKBgNVBAYMA1VTQTAeFw0yMjA4MDkxNTA4MzhaFw0yMzA4MDkx"
            , "NTA4MzhaMEcxDTALBgNVBAMMBEx1a2UxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIG"
            , "A1UECwwLZW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuB"
            , "BAAKA0IABEo5L1XbwQ0kqrM+61HydxVCvANUVncjqXxYGvMsaBgHc8QS4BF6GQQD"
            , "OILDJkfREUkRW0wT3kQXhcjVLRVdYeAwDAYIKoZIzj0EAwIFAANIADBFAiEAw/oq"
            , "6/T+yHQoKuvCg6MMQoth/F0JrFlPtGyM+auYPTECIEHbiDKXbaF2rhXBeEJFgZX1"
            , "prz3Yc03zv5VJ5rP/55A"
            , "-----END CERTIFICATE-----"
            ]
        }


data User = User
  { username :: T.Text
  , address :: Address
  } deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)
