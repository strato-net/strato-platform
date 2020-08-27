{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeSynonymInstances #-}
-- {-# LANGUAGE OverloadedStrings #-}
-- {-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}


module BlockApps.X509.Certificate (
  Issuer(..),
  Subject(..),
  certToBytes, 
--  privToBytes,
--  pubToBytes,
  bsToCert,
--  bsToPriv,
--  bsToPub,
  makeCert,
  makeSignedCert,
  newPriv,
 ) where




--import           Crypto.PubKey.ECC.DH
--import           Crypto.PubKey.ECC.ECDSA        
import           Crypto.PubKey.ECC.Types
import            Crypto.Random.Entropy
--import           Crypto.Number.Serialize
import           Crypto.Hash
import qualified Crypto.Hash.Algorithms         as CH

import qualified Crypto.Secp256k1               as SEC

--import           Data.ASN1.Encoding
--import           Data.ASN1.BinaryEncoding
import           Data.ASN1.OID
import           Data.ASN1.Types.String
--import           Data.ASN1.Types                
import qualified Data.ByteArray                 as BA
import qualified Data.ByteString                as B

import           Data.X509
import           Data.PEM
import           Data.Maybe

import           Blockchain.Data.RLP

import           Time.Types
import           Time.System
import           System.Random
--import           GHC.Generics






-- TODO: super temporary it's not even funny
newPriv :: IO (SEC.SecKey)
newPriv = do
  ent <- getEntropy 32
  return $ fromMaybe (error "could not create private key") (SEC.secKey ent)


-----------------------------------------------------------------------------------------------
--------------------------------- TYPES AND TYPECLASS INSTANCES -------------------------------
-----------------------------------------------------------------------------------------------



data Issuer = Issuer
  {
    issCommonName :: String
  , issCountry    :: String
  , issOrg        :: String
  , issPriv       :: SEC.SecKey
  } deriving (Show, Eq)


data Subject = Subject
  {
    subCommonName :: String
  , subCountry    :: String
  , subOrg        :: String
  , subUnit       :: String
  , subPub        :: SEC.PubKey
  } deriving (Show, Eq)



{-
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
  -}


instance RLPSerializable SignedCertificate where
  rlpEncode = RLPString . certToBytes
  
  rlpDecode (RLPString str) = bsToCert str
  rlpDecode x = error $ "rlpDecode for SignedCertificate failed: expected RLPString, got " ++ show x

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

{- 
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
-}

----------------------------------------------------------------------------------------------
---------------------------------------- READING ---------------------------------------------
----------------------------------------------------------------------------------------------





bsToCert :: B.ByteString -> SignedCertificate
bsToCert bs =
  case (pemParseBS bs) of
    Left str -> error str
    Right [] -> error "nothing parsed...but no errors?"
    Right (pem:_) -> 
      case (decodeSignedCertificate $ pemContent pem) of
        Left str -> error str
        Right cert -> cert

{-
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

--------------------------------------------------------------------------------------------
--------------------------------- CERT GENERATION AND SIGNING ------------------------------
--------------------------------------------------------------------------------------------




makeSignedCert :: Issuer -> Subject -> IO (SignedCertificate)
makeSignedCert iss sub = makeCert iss sub >>= signCert (issPriv iss)

signCert :: SEC.SecKey -> Certificate -> IO (SignedCertificate)
signCert priv cert = objectToSignedExactF (ecdsaWithSHA256 $ priv) cert

makeCert :: Issuer -> Subject -> IO (Certificate)
makeCert iss sub = do
  serial <- (randomRIO (10000000, 99999999)) -- TODO: how to not have repeat serials
  validity <- getValidity
  

  return Certificate {
    certVersion = 0x02
  , certSerial = serial
  , certSignatureAlg = SignatureALG HashSHA256 PubKeyALG_EC
  , certIssuerDN = getIssuerDN iss
  , certValidity = validity
  , certSubjectDN = getSubjectDN sub
  , certPubKey = getCertPub sub 
  , certExtensions = Extensions Nothing
  }



-- Data.X509's objectToSignedExact function expects a signing function with signature
-- B.ByteString -> f (B.ByteString, SignatureALG), and assumes that you will hash the
-- bytestring message, so hence this function. We partially apply the privkey when we 
-- pass it to objectToSignedExact
--
-- yea, I wish we could use Keccak256. Data.X509 hasn't caught up yet. Maybe I'll
-- make a PR for it
ecdsaWithSHA256 :: SEC.SecKey -> B.ByteString -> IO (B.ByteString, SignatureALG)
ecdsaWithSHA256 prv mesg' = do
  let mesgBS = B.pack $ BA.unpack $ hashWith CH.SHA256 mesg'
      mesg = fromMaybe (error "msg hash was not 32 bytes") (SEC.msg mesgBS)
      sig = SEC.signMsg prv mesg
  return (SEC.exportSig sig, SignatureALG HashSHA256 PubKeyALG_EC)



toASN1CS :: String -> ASN1CharacterString
toASN1CS = asn1CharacterString UTF8

{-
fromASN1CS :: ASN1CharacterString -> String
fromASN1CS cs = 
  let errstr = "failed to decode ASN1CharacterString: " ++ show cs
  in fromMaybe (error errstr) (asn1CharacterToString cs)
-}

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


getValidity :: IO (DateTime, DateTime)
getValidity = do
  (DateTime dt tm') <- dateCurrent
  let curDate@(DateTime _ tm) = DateTime dt tm'{todNSec = 0} -- need to wipe out nanseconds b/c they won't serialize
      endDate = DateTime dt{dateYear=(dateYear dt) + 1} tm -- all certs are valid for a year
  return (curDate, endDate)
 


----------------------------------------------------------------------------------------------
---------------------------------------- CONVERSIONS -----------------------------------------
----------------------------------------------------------------------------------------------


getCertPub :: Subject -> PubKey
getCertPub = serializeAndWrap . subPub


serializeAndWrap :: SEC.PubKey -> PubKey
serializeAndWrap pub =
  let serialPoint = SerializedPoint $ SEC.exportPubKey False pub
  in PubKeyEC $ PubKeyEC_Named SEC_p256k1 serialPoint
