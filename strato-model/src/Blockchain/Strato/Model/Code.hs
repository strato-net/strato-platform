{-# LANGUAGE DeriveGeneric #-}
module Blockchain.Strato.Model.Code where

import qualified Data.ByteString     as B
import           Data.Scientific     (toBoundedInteger, scientific)
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
  toJSON (PrecompiledCode x) = Number $ scientific (fromIntegral x) 0

instance FromJSON Code where
  parseJSON (String bytes) = return . Code . encodeUtf8 $ bytes
  parseJSON (Number x) = case toBoundedInteger x of
      Nothing -> error "number not integral"
      Just i -> return $ PrecompiledCode i
  parseJSON _ = error "invalid code structure"
