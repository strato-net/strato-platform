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
  bsToCert,
  makeCert,
  makeSignedCert,
  newPriv,
 ) where




import           Blockchain.Data.RLP

import           Crypto.PubKey.ECC.Types
import           Crypto.Random.Entropy
import           Crypto.Hash
import qualified Crypto.Hash.Algorithms         as CH
import qualified Crypto.Secp256k1               as SEC

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
import           Time.System
import           System.Random



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



instance RLPSerializable SignedCertificate where
  rlpEncode = RLPString . certToBytes
  
  rlpDecode (RLPString str) = bsToCert str
  rlpDecode x = error $ "rlpDecode for SignedCertificate failed: expected RLPString, got " ++ show x


instance ToJSON SignedCertificate where
  toJSON = String . T.pack . C8.unpack . certToBytes

instance FromJSON SignedCertificate where
  parseJSON (String str) = return $ bsToCert $ C8.pack $ T.unpack str
  parseJSON x = error $ "parseJSON for SignedCertificate expects a String, but was given " ++ show x



----------------------------------------------------------------------------------------------
--------------------------------------- IMPORT/EXPORT ----------------------------------------
----------------------------------------------------------------------------------------------


certToBytes :: SignedCertificate -> B.ByteString
certToBytes = pemWriteBS . certToPem

certToPem :: SignedCertificate -> PEM
certToPem cert = PEM 
  { pemName = "CERTIFICATE"
  , pemHeader = []
  , pemContent = encodeSignedObject cert
  }


bsToCert :: B.ByteString -> SignedCertificate
bsToCert bs =
  case (pemParseBS bs) of
    Left str -> error str
    Right [] -> error "nothing parsed...but no errors?"
    Right (pem:_) -> 
      case (decodeSignedCertificate $ pemContent pem) of
        Left str -> error str
        Right cert -> cert



--------------------------------------------------------------------------------------------
--------------------------------- CERT GENERATION AND SIGNING ------------------------------
--------------------------------------------------------------------------------------------



makeSignedCert :: Issuer -> Subject -> IO (SignedCertificate)
makeSignedCert iss sub = makeCert iss sub >>= signCert (issPriv iss)

signCert :: SEC.SecKey -> Certificate -> IO (SignedCertificate)
signCert priv cert = objectToSignedExactF (ecdsaWithSHA256 $ priv) cert

makeCert :: Issuer -> Subject -> IO (Certificate)
makeCert iss sub = do
  serial <- (randomRIO (10000000, 99999999)) -- TODO: might we have repeat serials?
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
 


getCertPub :: Subject -> PubKey
getCertPub = serializeAndWrap . subPub


serializeAndWrap :: SEC.PubKey -> PubKey
serializeAndWrap pub =
  let serialPoint = SerializedPoint $ SEC.exportPubKey False pub
  in PubKeyEC $ PubKeyEC_Named SEC_p256k1 serialPoint
