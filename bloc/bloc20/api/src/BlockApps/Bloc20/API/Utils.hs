{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE TypeApplications           #-}

module BlockApps.Bloc20.API.Utils where

import           Control.Lens                     (mapped, (&), (.~), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Types
import qualified Data.ByteString.Lazy.Char8       as Lazy.Char8
import           Data.Proxy
import           Data.String
import           Data.Text                        (Text)
import qualified Data.Text                        as Text
import           Generic.Random.Generic
import           GHC.Generics
import qualified Network.HTTP.Media               as M
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances        ()

import           BlockApps.Bloc20.API.SwaggerSchema
import           BlockApps.Ethereum
--------------------------------------------------------------------------------

type GetHomepage = Get '[PlainText] Homepage
whoWouldveThoughtThisIsActuallyTheHomepage :: Homepage
whoWouldveThoughtThisIsActuallyTheHomepage = Homepage "home page!"
newtype Homepage = Homepage { unHomepage :: Text }
    deriving (Eq, Ord, Read, Show, Generic, MimeRender PlainText, MimeUnrender PlainText)
instance ToSample Homepage where
    toSamples _ = noSamples
instance Arbitrary Homepage where -- seriously, lmfao
    arbitrary = return whoWouldveThoughtThisIsActuallyTheHomepage
instance ToSchema Homepage where
    declareNamedSchema _ = declareNamedSchema $ Proxy @ Text

data HTMLifiedJSON

instance Accept HTMLifiedJSON where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")

instance FromJSON x => MimeUnrender HTMLifiedJSON x where
  mimeUnrender _ = eitherDecode

instance ToJSON x => MimeRender HTMLifiedJSON x where
  mimeRender _ = encode
--------------------------------------------------------------------------------

data HTMLifiedAddress

instance Accept HTMLifiedAddress where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")

instance MimeUnrender HTMLifiedAddress Address where
  mimeUnrender _
    = maybe (Left "could not unrender Address") Right
    . stringAddress . Lazy.Char8.unpack

instance MimeRender HTMLifiedAddress Address where
  mimeRender _ = Lazy.Char8.pack . addressString

--------------------------------------------------------------------------------

newtype ContractName = ContractName Text deriving (Eq,Show,Generic)

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

-- hack because endpoints are returning stringified json
-- as application/octet-stream
instance FromJSON x => MimeUnrender OctetStream x where
  mimeUnrender _ = eitherDecode

instance ToJSON x => MimeRender OctetStream x where
 mimeRender _ = encode

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
    [ UserName uname | uname <- ["samrit", "eitan", "ilya", "ilir"]]

instance ToCapture (Capture "user" UserName) where
  toCapture _ = DocCapture "user" "a user name"

instance Arbitrary UserName where arbitrary = genericArbitrary uniform


instance ToParamSchema UserName

instance ToSchema UserName where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.schema.paramSchema.type_ .~ SwaggerString
    & mapped.schema.example ?~ toJSON (UserName "Martin")


--------------------------------------------------------------------------------

data TxParams = TxParams
  { txparamsGasLimit :: Maybe Gas
  , txparamsGasPrice :: Maybe Wei
  , txparamsNonce    :: Maybe Nonce
  } deriving (Eq,Show,Generic)

instance Arbitrary TxParams where arbitrary = genericArbitrary uniform

instance ToJSON TxParams where
  toJSON = genericToJSON (aesonPrefix camelCase){omitNothingFields = True}

instance FromJSON TxParams where
  parseJSON = genericParseJSON (aesonPrefix camelCase){omitNothingFields = True}

instance ToSchema TxParams where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Transaction Parameters"
    & mapped.schema.paramSchema.type_ .~ SwaggerObject
    & mapped.schema.example ?~ toJSON (TxParams (Just $ Gas 123) (Just $ Wei 345)
                                 (Just $ Nonce 9876))
