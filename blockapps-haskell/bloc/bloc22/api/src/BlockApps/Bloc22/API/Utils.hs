{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedLists            #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE TypeApplications           #-}

module BlockApps.Bloc22.API.Utils where

import           Control.Lens                     (mapped, (&), (.~), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Proxy
import           Data.String
import           Data.Text                        (Text)
import qualified Data.Text                        as Text
import qualified Generic.Random                   as GR
import           GHC.Generics
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances        ()

import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Ethereum

newtype ContractName = ContractName Text deriving (Eq,Ord,Show,Generic)

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
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.schema.description ?~ "The name of the smart contract."
    & mapped.schema.paramSchema.type_ .~ SwaggerString
    & mapped.schema.example ?~ toJSON (ContractName "MySmartContract")

--------------------------------------------------------------------------------

newtype UserName = UserName {getUserName :: Text} deriving (Eq,Show,Generic)

instance IsString UserName where
  fromString = UserName . Text.pack

instance ToHttpApiData UserName where
  toUrlPiece = getUserName

instance FromHttpApiData UserName where
  parseUrlPiece = Right . UserName

instance ToJSON UserName where
  toJSON = toJSON . getUserName

instance FromJSON UserName where
  parseJSON = fmap UserName . parseJSON

instance ToSample UserName where
  toSamples _ = samples
    [ UserName uname | uname <- ["samrit", "dustin", "yunfan", "daniel"]]

instance ToCapture (Capture "user" UserName) where
  toCapture _ = DocCapture "user" "a user name"

instance Arbitrary UserName where arbitrary = GR.genericArbitrary GR.uniform


instance ToParamSchema UserName

instance ToSchema UserName where
  declareNamedSchema _ = return $ NamedSchema (Just "User Name")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ toJSON (UserName "Nikita")
        & description ?~ "User Name" )

--------------------------------------------------------------------------------

data TxParams = TxParams
  { txparamsGasLimit :: Maybe Gas
  , txparamsGasPrice :: Maybe Wei
  , txparamsNonce    :: Maybe Nonce
  } deriving (Eq,Show,Generic)

instance Arbitrary TxParams where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON TxParams where
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}

instance FromJSON TxParams where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}

instance ToSchema TxParams where
  declareNamedSchema _ = do
    wordSchema <- declareSchemaRef (Proxy :: Proxy Word)
    return $ NamedSchema (Just "Transaction Parameters")
      ( mempty
        & type_ .~ SwaggerObject
        & example ?~ toJSON
          (TxParams (Just (Gas 123)) (Just (Wei 345)) (Just (Nonce 9876)))
        & description ?~ "Transaction Parameters"
        & properties .~
            [ ("gasLimit", wordSchema)
            , ("gasPrice", wordSchema)
            , ("nonce", wordSchema)
            ]
        & required .~ []
      )
