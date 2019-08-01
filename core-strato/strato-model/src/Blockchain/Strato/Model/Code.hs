{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Strato.Model.Code where

import           Control.DeepSeq
import           Data.Binary
import qualified Data.ByteString     as B
import qualified Data.ByteString.Base16     as B16
import           Data.Data
import qualified Data.Text as T
import           Data.Text.Encoding  (encodeUtf8, decodeUtf8)
import           GHC.Generics
import           Data.Aeson
import           Data.Aeson.Types

import           Blockchain.Data.RLP

data Code = Code{codeBytes::B.ByteString}
          | PrecompiledCode Int
          deriving (Show, Eq, Read, Ord, Generic, Data)

instance Binary Code where
instance NFData Code

instance RLPSerializable Code where
    rlpEncode (Code bytes) = rlpEncode bytes
    rlpEncode (PrecompiledCode _) = error "Error in call to rlpEncode for Code: Precompiled contracts can not be serialized."
    rlpDecode = Code . rlpDecode

instance ToJSON Code where
  toJSON (Code bytes) = String . decodeUtf8 . B16.encode $ bytes
  toJSON (PrecompiledCode _) = error "cannot serialize precompiled codes"

instance FromJSON Code where
  parseJSON (String text) = return . Code . fst . B16.decode . encodeUtf8 . drop0x $ text
    where drop0x :: T.Text -> T.Text
          drop0x t = if "0x" `T.isPrefixOf` t
                       then T.drop 2 t
                       else t
  parseJSON x = typeMismatch "Code" x
