{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE DeriveGeneric        #-}
{-# LANGUAGE DeriveAnyClass       #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}


module BlockApps.Bloc22.API.X509 where

import           GHC.Generics

import           Control.Lens                 ((&), (?~), mapped)
import           Data.Aeson.Types             hiding (fieldLabelModifier)
import qualified Data.ByteString.Char8        as C8
import           Data.Either
import           Data.Swagger
import           Data.Text                     hiding (unlines)

import           Servant
import           Servant.Docs

import           BlockApps.X509.Certificate
import           BlockApps.X509.Keys

type CreateCertificate = "x509" :> "createCert"
              :> Header' '[Required, Strict] "X-USER-ACCESS-TOKEN" Text
              :> ReqBody '[JSON] CreateCertEndpoint
              :> Get '[JSON] X509Certificate


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

instance ToSample CreateCertEndpoint where
  toSamples _ = singleSample ex

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
