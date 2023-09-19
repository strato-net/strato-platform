{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.API.Utils where

import Bloc.API.SwaggerSchema
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Wei
import Control.Lens (mapped, (&), (.~), (?~))
import Data.Aeson
import Data.Aeson.Casing
import Data.Proxy
import Data.String
import Data.Text (Text)
import qualified Data.Text as Text
import GHC.Generics
import qualified Generic.Random as GR
import Servant.API
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

newtype ContractName = ContractName Text deriving (Eq, Ord, Show, Generic)

instance Arbitrary ContractName where
  arbitrary = GR.genericArbitrary GR.uniform

instance IsString ContractName where
  fromString = ContractName . Text.pack

instance ToHttpApiData ContractName where
  toUrlPiece (ContractName cname) = cname

instance FromHttpApiData ContractName where
  parseUrlPiece = Right . ContractName

instance ToJSON ContractName where
  toJSON (ContractName cname) = toJSON cname

instance FromJSON ContractName where
  parseJSON = fmap ContractName . parseJSON

instance ToCapture (Capture "contractName" ContractName) where
  toCapture _ = DocCapture "contractName" "a contract name"

instance ToParamSchema ContractName

instance ToSchema ContractName where
  declareNamedSchema proxy =
    genericDeclareNamedSchema defaultSchemaOptions proxy
      & mapped . schema . description ?~ "The name of the smart contract."
      & mapped . schema . paramSchema . type_ ?~ SwaggerString
      & mapped . schema . example ?~ toJSON (ContractName "MySmartContract")

--------------------------------------------------------------------------------

newtype JwtToken = JwtToken {getJwtToken :: Text} deriving (Eq, Show, Generic)

instance IsString JwtToken where
  fromString = JwtToken . Text.pack

instance ToHttpApiData JwtToken where
  toUrlPiece = getJwtToken

instance FromHttpApiData JwtToken where
  parseUrlPiece = Right . JwtToken

instance ToJSON JwtToken where
  toJSON = toJSON . getJwtToken

instance FromJSON JwtToken where
  parseJSON = fmap JwtToken . parseJSON

instance ToSample JwtToken where
  toSamples _ =
    samples
      [JwtToken jwt | jwt <- ["samrit", "dustin", "yunfan", "daniel", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"]]

instance ToCapture (Capture "user" JwtToken) where
  toCapture _ = DocCapture "user" "a jwt string token"

instance Arbitrary JwtToken where arbitrary = GR.genericArbitrary GR.uniform

instance ToParamSchema JwtToken

instance ToSchema JwtToken where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "R5cCI6IkpXVCJ9.eyJzdFAKESTUFFF.asd123nKJF")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ toJSON (JwtToken "Nikita")
            & description ?~ "User Name"
        )

--------------------------------------------------------------------------------

data TxParams = TxParams
  { txparamsGasLimit :: Maybe Gas,
    txparamsGasPrice :: Maybe Wei,
    txparamsNonce :: Maybe Nonce
  }
  deriving (Eq, Show, Generic)

instance Arbitrary TxParams where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON TxParams where
  toJSON = genericToJSON (aesonPrefix camelCase) {omitNothingFields = True}

instance FromJSON TxParams where
  parseJSON = genericParseJSON (aesonPrefix camelCase) {omitNothingFields = True}

instance ToSchema TxParams where
  declareNamedSchema _ = do
    wordSchema <- declareSchemaRef (Proxy :: Proxy Word)
    return $
      NamedSchema
        (Just "Transaction Parameters")
        ( mempty
            & type_ ?~ SwaggerObject
            & example
              ?~ toJSON
                (TxParams (Just (Gas 123)) (Just (Wei 345)) (Just (Nonce 9876)))
            & description ?~ "Transaction Parameters"
            & properties
              .~ [ ("gasLimit", wordSchema),
                   ("gasPrice", wordSchema),
                   ("nonce", wordSchema)
                 ]
            & required .~ []
        )
