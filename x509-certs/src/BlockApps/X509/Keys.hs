-- {-# LANGUAGE StandaloneDeriving #-}
-- {-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE OverloadedStrings #-}
-- {-# LANGUAGE FlexibleContexts #-}
-- {-# LANGUAGE FlexibleInstances #-}
-- {-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}


module BlockApps.X509.Keys where


{-

import           Crypto.PubKey.ECC.DH
import           Crypto.PubKey.ECC.ECDSA        
import           Crypto.Number.Serialize
import           Crypto.PubKey.ECC.Types
import           Crypto.Random.Entropy
import           Crypto.Hash
import qualified Crypto.Hash.Algorithms         as CH
import qualified Crypto.Secp256k1               as SEC

import           Data.ASN1.Encoding
import           Data.ASN1.BinaryEncoding
import           Data.ASN1.Types                
import           Data.Aeson
import           Data.ASN1.OID
import           Data.ASN1.Types.String
import qualified Data.ByteArray                 as BA
import qualified Data.ByteString                as B
import qualified Data.ByteString.Char8          as C8
import           Data.Maybe
import           Data.PEM
import qualified Data.Text                      as T
import           Data.X509

import           Time.Types



-- TODO: migrate this to secp256k1-haskell types, if we ever need it....

 
-- why oh why does the ASN1Object instance for PrivKey not come with the X509 import...
instance ASN1Object PrivKeyEC where
  toASN1 (PrivKeyEC_Named SEC_p256k1 d) xs = 
    ( Start Sequence
      : IntVal 1
      : OctetString (i2osp d)
      : Start (Container Context 0) 
      : OID [1,3,132,0,10]
      : End (Container Context 0)
      : End Sequence 
      : xs 
    )
  toASN1 _ _ = error "no ASN1 encoding for this kind of EC private key"

  fromASN1 [] = error "tried to decode an empty ASN1 object?"
  fromASN1 ( Start Sequence 
        : IntVal 1 
        : OctetString str 
        : Start (Container Context 0) 
        : OID [1,3,132,0,10]
        : End (Container Context 0) 
        : End Sequence : xs ) = Right (PrivKeyEC_Named SEC_p256k1 (os2ip str), xs) 
  fromASN1 _ = error "no ASN1 decoding for this kind of EC private key"



----------------------------------------------------------------------------------------------
-------------------------------------- READING/WRITING ---------------------------------------
----------------------------------------------------------------------------------------------
 

privToBytes :: PrivateNumber -> B.ByteString
privToBytes = pemWriteBS . privToPem

privToPem :: PrivateNumber -> PEM
privToPem priv = PEM
  { pemName = "EC PRIVATE KEY"
  , pemHeader = []
  , pemContent = encodeASN1' DER $ toASN1 (PrivKeyEC_Named SEC_p256k1 priv) [] 
  }


pubToBytes :: PublicPoint -> B.ByteString
pubToBytes = pemWriteBS . pubToPem

pubToPem :: PublicPoint -> PEM
pubToPem pub = PEM
  { pemName = "PUBLIC KEY"
  , pemHeader = []
  , pemContent = encodeASN1' DER $ toASN1 (serializeAndWrap pub) []
  }



bsToPriv :: B.ByteString -> PrivateNumber
bsToPriv bs =
  case (pemParseBS bs) of
    Left str -> error str
    Right [] -> error "nothing parsed...but no errors?"
    Right (pem:_) -> 
      case (decodeASN1' DER $ pemContent pem) of
        Left err -> error (show err)
        Right asn -> case fromASN1 asn of
          Left str' -> error str'
          Right (PrivKeyEC_Named SEC_p256k1 priv, _) -> priv
          Right _ -> error "we didn't encode this private key, its a diff type"

bsToPub :: B.ByteString -> PublicPoint
bsToPub bs = 
  case (pemParseBS bs) of
    Left str -> error str
    Right [] -> error "nothing parsed....but no errors?"
    Right (pem:_) ->
      case (decodeASN1' DER $ pemContent pem) of
        Left err -> error (show err)
        Right asn -> case fromASN1 asn of
          Left str -> error str
          Right (PubKeyEC (PubKeyEC_Named SEC_p256k1 serialPt), _) -> fromMaybe (error "could not deserialize public point") $ unserializePoint (getCurveByName SEC_p256k1) serialPt
          Right _ -> error "we didn't encode this public key, its a diff type"
-}
