{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeSynonymInstances #-}
-- {-# LANGUAGE OverloadedStrings #-}
-- {-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}


module Generate (
  Issuer(..),
  Subject(..),
  certToBytes, 
  privToBytes,
  pubToBytes,
  bsToCert,
  bsToPriv,
  bsToPub,
  makeSignedCert,
  signWithECDSA,
  fromASN1CS -- TODO: you don't need this to be exported...create the Issuer maker func
 ) where




import           Crypto.PubKey.ECC.DH
import           Crypto.PubKey.ECC.ECDSA        
import           Crypto.PubKey.ECC.Types
import           Crypto.Number.Serialize
import qualified Crypto.Hash.Algorithms         as CH



import           Data.ASN1.Encoding
import           Data.ASN1.BinaryEncoding
import           Data.ASN1.OID
import           Data.ASN1.Types.String
import           Data.ASN1.Types                
import           Data.Serialize
import           Data.Hourglass.Types


import qualified Data.ByteString                as B
import           Data.X509
import           Data.X509.EC
import           Data.PEM
import           Data.Maybe

import qualified ECDSA                          as ECD


import           GHC.Generics


-- import           System.IO.Unsafe               -- please, don't shame me!
 --import           Crypto.PubKey.ECC.Generate       (generate)







-----------------------------------------------------------------------------------------------
--------------------------------- TYPES AND TYPECLASS INSTANCES -------------------------------
-----------------------------------------------------------------------------------------------



data Issuer = Issuer
  {
    issCommonName :: String
  , issCountry    :: String
  , issOrg        :: String
  , issPriv       :: PrivateNumber
  }


data Subject = Subject
  {
    subCommonName :: String
  , subCountry    :: String
  , subOrg        :: String
  , subUnit       :: String
  , subPub        :: PublicPoint
  }




deriving instance Generic PublicPoint
deriving instance Serialize PublicPoint


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
----------------------------------------- WRITING --------------------------------------------
----------------------------------------------------------------------------------------------




certToBytes :: SignedCertificate -> B.ByteString
certToBytes = pemWriteBS . certToPem

certToPem :: SignedCertificate -> PEM
certToPem cert = PEM 
  { pemName = "CERTIFICATE"
  , pemHeader = []
  , pemContent = encodeSignedObject cert
  }


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


----------------------------------------------------------------------------------------------
---------------------------------------- READING ---------------------------------------------
----------------------------------------------------------------------------------------------


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




bsToCert :: B.ByteString -> SignedCertificate
bsToCert bs =
  case (pemParseBS bs) of
    Left str -> error str
    Right [] -> error "nothing parsed...but no errors?"
    Right (pem:_) -> 
      case (decodeSignedCertificate $ pemContent pem) of
        Left str -> error str
        Right cert -> cert


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



--------------------------------------------------------------------------------------------
--------------------------------- CERT GENERATION AND SIGNING ------------------------------
--------------------------------------------------------------------------------------------




makeSignedCert :: Issuer -> Subject -> SignedCertificate 
makeSignedCert iss sub = signCert (issPriv iss) $ makeCert iss sub

signCert :: PrivateNumber -> Certificate -> SignedCertificate
signCert priv' cert = fst $ objectToSignedExact (signWithECDSA $ priv) cert
  where
    priv = PrivateKey (getCurveByName SEC_p256k1) priv'

makeCert :: Issuer -> Subject -> Certificate
makeCert iss sub = Certificate {
    certVersion = 0x02
  , certSerial = serial -- TODO: have to at some point randomly generate this and store it
  , certSignatureAlg = SignatureALG HashSHA256 PubKeyALG_EC
  , certIssuerDN = getIssuerDN iss
  , certValidity = getValidity
  , certSubjectDN = getSubjectDN sub
  , certPubKey = getCertPub sub 
  , certExtensions = Extensions Nothing
  }
  where
    serial = 1234567




-- We must provide the signing function with a a specific signature, so here is a wrapper for
--   the ECDSA signing function
-- TODO: would rather not use signWith (need a random number, not 19), can we figure out the MonadRandom signature and use sign? Or get entropy to seed that number
signWithECDSA :: PrivateKey -> B.ByteString -> (B.ByteString, SignatureALG, ())
signWithECDSA priv msg = do
  let hash = CH.SHA256
      sig = case (signWith 19 priv hash msg) of
        Just sig' -> sig'
        Nothing -> error "Could not sign x509 cert with private key"
  (ECD.signatureEncodeDER $ sillySignatureConversion sig, SignatureALG HashSHA256 PubKeyALG_EC, ()) 



toASN1CS :: String -> ASN1CharacterString
toASN1CS = asn1CharacterString UTF8

fromASN1CS :: ASN1CharacterString -> String
fromASN1CS cs = 
  let errstr = "failed to decode ASN1CharacterString: " ++ show cs
  in fromMaybe (error errstr) (asn1CharacterToString cs)


getIssuerDN :: Issuer -> DistinguishedName
getIssuerDN iss = 
  DistinguishedName 
  [ (getObjectID DnCommonName, toASN1CS $ issCommonName iss)
  , (getObjectID DnCountry, toASN1CS $ issCountry iss)
  , (getObjectID DnOrganization, toASN1CS $ issOrg iss)
  ]

 
getSubjectDN :: Subject -> DistinguishedName
getSubjectDN sub = 
  DistinguishedName
  [ (getObjectID DnCommonName, toASN1CS $ subCommonName sub)
  , (getObjectID DnCountry, toASN1CS $ subCountry sub)
  , (getObjectID DnOrganization, toASN1CS $ subOrg sub)
  , (getObjectID DnOrganizationUnit, toASN1CS $ subUnit sub)
  ]


-- Pure garbage right now....TODO: get it from IO? do it unsafe? 
getValidity :: (DateTime, DateTime)
getValidity = do
  let startDate = Date 2019 November 21
      startTime = TimeOfDay 16 33 0 0
      endDate = Date 2020 November 22
      endTime = TimeOfDay 16 33 0 0
  (DateTime startDate startTime, DateTime endDate endTime)
 


----------------------------------------------------------------------------------------------
-------------------------------------- READS/CONVERSION --------------------------------------
----------------------------------------------------------------------------------------------


getCertPub :: Subject -> PubKey
getCertPub = serializeAndWrap . subPub


serializeAndWrap :: PublicPoint -> PubKey
serializeAndWrap pub = 
  let serialPoint = serializePoint (getCurveByName SEC_p256k1) pub
      eccKey = case serialPoint of
        Right pt -> PubKeyEC_Named SEC_p256k1 pt
        Left str -> error $ "ERROR: could not serialize public key - " ++ str
  in PubKeyEC eccKey


-- Unfortunately ECDSA module has the function for encoding signatures as DER, but the signature type
-- we use for Data.X509 is defined in Crypto.PubKey.ECC.ECDSA. They are the same under the hood, but we
-- still need to convert them to do the DER encoding. Hence, this function below
sillySignatureConversion :: Signature -> ECD.Signature
sillySignatureConversion sig = ECD.Signature (sign_r sig) (sign_s sig)




-- NOTE: This function serializePoint is literally stolen from a PR made to the Data.X509 repo 
--    that was never merged
--    for someone reason they have a function to deserialize but not to serialize points 

-- https://github.com/vincenthz/hs-certificate/pull/111/files

serializePoint :: Curve -> Point -> Either String SerializedPoint
serializePoint _curve PointO = Left "Serializing Point0 not supported"
serializePoint curve (Point px py) = SerializedPoint . B.cons ptFormat <$> output
    where
      ptFormat = 4 -- non compressed format
      output = (<>) <$> serializedX <*> serializedY
      serializedX = maybe
                    (Left "could not serialize the point's x dimension into a bytestring of given size")
                    Right
                    $ i2ospOf dimensionLength px
      serializedY = maybe
                    (Left "could not serialize the point's y dimension into a bytestring of given size")
                    Right
                    $ i2ospOf dimensionLength py

      bits            = curveSizeBits curve
      dimensionLength = (bits + 7) `div` 8


