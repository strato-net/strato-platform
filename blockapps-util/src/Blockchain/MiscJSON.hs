{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.MiscJSON where

import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Text.Encoding
import Data.Aeson.Types

instance FromJSON B.ByteString where
    parseJSON (String t) = pure . fst . B16.decode $ encodeUtf8 t
    parseJSON v          = typeMismatch "ByteString" v

instance ToJSON B.ByteString where
    toJSON  = String . decodeUtf8 .  B16.encode
