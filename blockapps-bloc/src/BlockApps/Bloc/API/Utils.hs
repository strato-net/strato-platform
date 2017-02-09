{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
#-}

module BlockApps.Bloc.API.Utils where

import Data.Aeson
import qualified Data.ByteString.Char8 as Char8
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import Data.Functor.Contravariant
import Data.Maybe
import Data.Text (Text)
import GHC.Generics
import qualified Hasql.Decoders as Decoders
import qualified Hasql.Encoders as Encoders
import Servant.API
import Servant.Client
import Servant.Docs
import qualified Network.HTTP.Media as M
import Test.QuickCheck

import BlockApps.Data

-- hack because endpoints are returning stringified json as text/html
data HTMLifiedJSON
instance Accept HTMLifiedJSON where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance FromJSON x => MimeUnrender HTMLifiedJSON x where
  mimeUnrender _ = eitherDecode
instance ToJSON x => MimeRender HTMLifiedJSON x where
  mimeRender _ = encode

data HTMLifiedAddress
instance Accept HTMLifiedAddress where
  contentType _ = "text" M.// "html" M./: ("charset", "utf-8")
instance MimeUnrender HTMLifiedAddress Address where
  mimeUnrender _
    = maybe (Left "could not unrender Address") Right
    . stringAddress . Lazy.Char8.unpack
instance MimeRender HTMLifiedAddress Address where
  mimeRender _ = Lazy.Char8.pack . addressString

newtype UnstructuredJSON = UnstructuredJSON
  { getUnstructuredJSON :: Value
  } deriving (Eq,Show,Generic)
instance ToJSON UnstructuredJSON where
  toJSON (UnstructuredJSON resp) = toJSON resp
instance FromJSON UnstructuredJSON where
  parseJSON = fmap UnstructuredJSON . parseJSON
instance Arbitrary UnstructuredJSON where
  arbitrary = return $ UnstructuredJSON Null
instance ToSample UnstructuredJSON where
  toSamples _ = noSamples

newtype ContractName = ContractName Text
instance ToHttpApiData ContractName where
  toUrlPiece (ContractName name) = name
instance FromHttpApiData ContractName where
  parseUrlPiece = Right . ContractName
instance ToJSON ContractName where
  toJSON (ContractName name) = toJSON name
instance FromJSON ContractName where
  parseJSON = fmap ContractName . parseJSON
instance ToCapture (Capture "contractName" ContractName) where
  toCapture _ = DocCapture "contractName" "a contract name"

-- hack because endpoints are returning stringified json
-- as application/octet-stream
instance FromJSON x => MimeUnrender OctetStream x where
  mimeUnrender _ = eitherDecode
instance ToJSON x => MimeRender OctetStream x where
  mimeRender _ = encode

addressDecoder :: Decoders.Value Address
addressDecoder
  = fromMaybe (error "cannot decode address")
  . stringAddress
  . Char8.unpack <$> Decoders.bytea

addressEncoder :: Encoders.Value Address
addressEncoder = contramap (Char8.pack . addressString) Encoders.bytea

urlTesterBloc :: BaseUrl
urlTesterBloc = BaseUrl Http "tester7.centralus.cloudapp.azure.com" 80 "/bloc"
