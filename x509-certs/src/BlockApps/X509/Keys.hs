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

  fromASN1 [] = error "tried to decode an empty ASN1 object?"
  fromASN1 ( Start Sequence 
        : IntVal 1 
        : OctetString str 
        : Start (Container Context 0) 
        : OID [1,3,132,0,10]
        : End (Container Context 0) 
        : End Sequence : xs ) = Right ((fromMaybe (error "could not asn1decode privkey") (SEC.secKey str)), xs) 
  fromASN1 _ = error "no ASN1 decoding for this kind of EC private key"



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

{-
privToInteger :: SEC.SecKey -> Integer
privToInteger = 
  let fromBytes = B.foldl' (\a b -> a `shiftL` 8 .|. fromIntegral b) 0
  in fromBytes . SEC.getSecKey

integerToPriv :: Integer -> SEC.SecKey
integerToPriv i = fromMaybe (error "could not import private key") (SEC.secKey $ intToBytes i) 

intToBytes :: Integer -> B.ByteString
intToBytes x = map (fromIntegral . (x `shiftR`)) [256-8, 256-16..0]
-}

pubToBytes :: SEC.PubKey -> B.ByteString
pubToBytes = pemWriteBS . pubToPem

pubToPem :: SEC.PubKey -> PEM
pubToPem pub = PEM
  { pemName = "PUBLIC KEY"
  , pemHeader = []
  , pemContent = encodeASN1' DER $ toASN1 (serializeAndWrap pub) []
  }



bsToPriv :: B.ByteString -> SEC.SecKey
bsToPriv bs =
  case (pemParseBS bs) of
    Left str -> error str
    Right [] -> error "nothing parsed...but no errors?"
    Right (pem:_) -> 
      case (decodeASN1' DER $ pemContent pem) of
        Left err -> error (show err)
        Right asn -> case fromASN1 asn of
          Left str' -> error str'
          Right (priv, _) -> priv

bsToPub :: B.ByteString -> SEC.PubKey
bsToPub bs = 
  case (pemParseBS bs) of
    Left str -> error str
    Right [] -> error "nothing parsed....but no errors?"
    Right (pem:_) ->
      case (decodeASN1' DER $ pemContent pem) of
        Left err -> error (show err)
        Right asn -> case fromASN1 asn of
          Left str -> error str
          Right (pub, _) -> fromMaybe (error "could not parse pubkey") (unserializeAndUnwrap pub)


serializeAndWrap :: SEC.PubKey -> PubKey
serializeAndWrap pub =
  let serialPoint = SerializedPoint $ SEC.exportPubKey False pub
  in PubKeyEC $ PubKeyEC_Named SEC_p256k1 serialPoint

unserializeAndUnwrap :: PubKey -> Maybe SEC.PubKey
unserializeAndUnwrap (PubKeyEC (PubKeyEC_Named SEC_p256k1 (SerializedPoint sp))) = SEC.importPubKey sp
unserializeAndUnwrap x = error $ "unserializeAndUnwrap called with unsupported pubkey type: " ++ show x
