{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.MiscJSON where

import Data.Aeson
import Data.Aeson.Types
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Short as BSS
import Data.Text.Encoding
import qualified LabeledError

instance FromJSON B.ByteString where
  parseJSON (String t) = pure . LabeledError.b16Decode "FromJSON<ByteString>" $ encodeUtf8 t
  parseJSON v = typeMismatch "ByteString" v

instance ToJSON B.ByteString where
  toJSON = String . decodeUtf8 . B16.encode

instance ToJSONKey B.ByteString where
  toJSONKey = toJSONKeyText (decodeUtf8 . B16.encode)

instance FromJSON BSS.ShortByteString where
  parseJSON (String t) = pure . BSS.toShort . LabeledError.b16Decode "FromJSON<ShortByteString>" $ encodeUtf8 t
  parseJSON v = typeMismatch "ShortByteString" v

instance ToJSON BSS.ShortByteString where
  toJSON = String . decodeUtf8 . B16.encode . BSS.fromShort
