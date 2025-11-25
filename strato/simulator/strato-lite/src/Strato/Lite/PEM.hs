{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Lite.PEM where

import Blockchain.Strato.Model.Secp256k1
import Data.ASN1.BinaryEncoding
import Data.ASN1.Encoding
import Data.ASN1.Types
import qualified Data.ByteString as B
import Data.PEM

privToBytes :: PrivateKey -> B.ByteString
privToBytes = pemWriteBS . privToPem

privToPem :: PrivateKey -> PEM
privToPem priv =
  PEM
    { pemName = "EC PRIVATE KEY",
      pemHeader = [],
      pemContent = encodeASN1' DER $ toASN1 priv []
    }

bsToPriv :: B.ByteString -> Either String PrivateKey
bsToPriv bs =
  case (pemParseBS bs) of
    Left str -> Left str
    Right [] -> Left "valid PEM file, but no content"
    Right (pem : _) ->
      case (decodeASN1' DER $ pemContent pem) of
        Left err -> Left (show err)
        Right asn -> case fromASN1 asn of
          Left str' -> Left str'
          Right (priv, _) -> Right priv