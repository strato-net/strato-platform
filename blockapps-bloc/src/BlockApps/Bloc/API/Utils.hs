{-# LANGUAGE
    DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
#-}

module BlockApps.Bloc.API.Utils where

import Data.Aeson
import qualified Data.ByteString.Lazy.Char8 as Lazy.Char8
import GHC.Generics
import Servant.API
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
