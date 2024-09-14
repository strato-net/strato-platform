{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.X509.Keys where

import Blockchain.Strato.Model.Secp256k1
import Crypto.PubKey.ECC.Types (CurveName (..))
import Data.ASN1.BinaryEncoding
import Data.ASN1.Encoding
import Data.ASN1.Types
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import Data.PEM
import Data.X509

rootPubKey :: PublicKey
rootPubKey =
  let key =
        bsToPub $
          C8.pack $
            unlines
              [ "-----BEGIN PUBLIC KEY-----",
                "MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z",
                "0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==",
                "-----END PUBLIC KEY-----"
              ]
   in case key of
        Left e -> error e
        Right k -> k

----------------------------------------------------------------------------------------------
-------------------------------------- READING/WRITING ---------------------------------------
----------------------------------------------------------------------------------------------

privToBytes :: PrivateKey -> B.ByteString
privToBytes = pemWriteBS . privToPem

privToPem :: PrivateKey -> PEM
privToPem priv =
  PEM
    { pemName = "EC PRIVATE KEY",
      pemHeader = [],
      pemContent = encodeASN1' DER $ toASN1 priv []
    }

pubToBytes :: PublicKey -> B.ByteString
pubToBytes = pemWriteBS . pubToPem

pubToPem :: PublicKey -> PEM
pubToPem pub =
  PEM
    { pemName = "PUBLIC KEY",
      pemHeader = [],
      pemContent = encodeASN1' DER $ toASN1 (serializeAndWrap pub) []
    }

-- TODO:  maybe make custom exception types for the Left
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

bsToPub :: B.ByteString -> Either String PublicKey
bsToPub bs =
  case (pemParseBS bs) of
    Left str -> Left str
    Right [] -> Left "valid PEM file, but no content"
    Right (pem : _) ->
      case (decodeASN1' DER $ pemContent pem) of
        Left err -> Left (show err)
        Right asn -> case fromASN1 asn of
          Left str -> Left str
          Right (pub', _) -> case unserializeAndUnwrap pub' of
            Just pub -> Right pub
            Nothing -> Left $ "failed to unserialize and unwrap this key " ++ (show pub')

-- from the actual secp256k1 type to the X509 wrapper type
serializeAndWrap :: PublicKey -> PubKey
serializeAndWrap pub =
  let serialPoint = SerializedPoint $ exportPublicKey False pub
   in PubKeyEC $ PubKeyEC_Named SEC_p256k1 serialPoint

-- from the X509 wrapper type to the actual secp256k1 type
unserializeAndUnwrap :: PubKey -> Maybe PublicKey
unserializeAndUnwrap (PubKeyEC (PubKeyEC_Named SEC_p256k1 (SerializedPoint sp))) = importPublicKey sp
unserializeAndUnwrap _ = Nothing
