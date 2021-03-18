-- {-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE OverloadedStrings #-}
-- {-# LANGUAGE FlexibleContexts #-}
-- {-# LANGUAGE FlexibleInstances #-}
-- {-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}


module BlockApps.X509.Keys where



import           Crypto.PubKey.ECC.Types        (CurveName(..))
import           Crypto.Random.Entropy
import qualified Crypto.Secp256k1               as SEC

import           Data.ASN1.Encoding
import           Data.ASN1.BinaryEncoding
import           Data.ASN1.Types                
import qualified Data.ByteString                as B
import           Data.Maybe
import           Data.PEM
import           Data.X509



-- just the one orphan instance, I promise
instance ASN1Object SEC.SecKey where
  toASN1 key xs = 
    ( Start Sequence
      : IntVal 1
      : OctetString (SEC.getSecKey key)
      : Start (Container Context 0) 
      : OID [1,3,132,0,10]
      : End (Container Context 0)
      : End Sequence 
      : xs 
    )

  fromASN1 [] = fail "tried to decode an empty ASN1 object?"
  fromASN1 ( Start Sequence 
        : IntVal 1 
        : OctetString str 
        : Start (Container Context 0) 
        : OID [1,3,132,0,10]
        : End (Container Context 0) 
        : End Sequence : xs ) = case (SEC.secKey str) of
                                  Nothing -> fail "could not asn1decode privkey"
                                  Just pk -> Right (pk, xs) 
  fromASN1 _ = fail "no ASN1 decoding for this kind of EC private key"



newPriv :: IO (SEC.SecKey)
newPriv = do
  ent <- getEntropy 32
  return $ fromMaybe (error "could not create private key") (SEC.secKey ent)



----------------------------------------------------------------------------------------------
-------------------------------------- READING/WRITING ---------------------------------------
----------------------------------------------------------------------------------------------
 

privToBytes :: SEC.SecKey -> B.ByteString
privToBytes = pemWriteBS . privToPem

privToPem :: SEC.SecKey -> PEM
privToPem priv = PEM
  { pemName = "EC PRIVATE KEY"
  , pemHeader = []
  , pemContent = encodeASN1' DER $ toASN1 priv [] 
  }


pubToBytes :: SEC.PubKey -> B.ByteString
pubToBytes = pemWriteBS . pubToPem

pubToPem :: SEC.PubKey -> PEM
pubToPem pub = PEM
  { pemName = "PUBLIC KEY"
  , pemHeader = []
  , pemContent = encodeASN1' DER $ toASN1 (serializeAndWrap pub) []
  }


-- TODO:  maybe make custom exception types for the Left
bsToPriv :: B.ByteString -> Either String SEC.SecKey
bsToPriv bs =
  case (pemParseBS bs) of
    Left str -> Left str
    Right [] -> Left "valid PEM file, but no content"
    Right (pem:_) -> 
      case (decodeASN1' DER $ pemContent pem) of
        Left err -> Left (show err)
        Right asn -> case fromASN1 asn of
          Left str' -> Left str'
          Right (priv, _) -> Right priv

bsToPub :: B.ByteString -> Either String SEC.PubKey
bsToPub bs = 
  case (pemParseBS bs) of
    Left str -> Left str
    Right [] -> Left "valid PEM file, but no content"
    Right (pem:_) ->
      case (decodeASN1' DER $ pemContent pem) of
        Left err -> Left (show err)
        Right asn -> case fromASN1 asn of
          Left str -> Left str
          Right (pub, _) -> Right $ fromMaybe (error "could not unserialize key") $ unserializeAndUnwrap pub


serializeAndWrap :: SEC.PubKey -> PubKey
serializeAndWrap pub =
  let serialPoint = SerializedPoint $ SEC.exportPubKey False pub
  in PubKeyEC $ PubKeyEC_Named SEC_p256k1 serialPoint

unserializeAndUnwrap :: PubKey -> Maybe SEC.PubKey
unserializeAndUnwrap (PubKeyEC (PubKeyEC_Named SEC_p256k1 (SerializedPoint sp))) = SEC.importPubKey sp
unserializeAndUnwrap x = error $ "unserializeAndUnwrap called with unsupported pubkey type: " ++ show x
