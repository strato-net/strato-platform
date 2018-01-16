{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Strato.Model.Code where

import qualified Data.ByteString     as B
import           Data.Text.Encoding  (decodeUtf8, encodeUtf8)
import           GHC.Generics
import           Data.Aeson

import           Blockchain.Data.RLP

data Code = Code{codeBytes::B.ByteString}
          | PrecompiledCode Int
          deriving (Show, Eq, Read, Ord, Generic)

instance RLPSerializable Code where
    rlpEncode (Code bytes) = rlpEncode bytes
    rlpEncode (PrecompiledCode _) = error "Error in call to rlpEncode for Code: Precompiled contracts can not be serialized."
    rlpDecode = Code . rlpDecode

instance ToJSON Code where
  toJSON (Code bytes) = String . decodeUtf8 $ bytes
  toJSON (PrecompiledCode _) = error "cannot serialize precompiled codes"

instance FromJSON Code where
  parseJSON (String text) = return . Code . encodeUtf8 $ text
  parseJSON _ = error "malformed code"
