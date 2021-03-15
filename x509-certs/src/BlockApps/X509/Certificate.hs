{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE OverloadedStrings #-}
-- {-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}


module BlockApps.X509.Certificate (
  X509Certificate(..),
  Issuer(..),
  Subject(..),
  certToBytes, 
  bsToCert,
  makeCert,
  makeSignedCert,
  fromASN1CS -- I'd rather not
 ) where




import           Blockchain.Data.RLP
import           BlockApps.X509.Keys

import           Crypto.Random.Entropy
import           Crypto.Hash
import qualified Crypto.Hash.Algorithms         as CH
import qualified Crypto.Secp256k1               as SEC

import           Data.Aeson
import           Data.ASN1.OID
import           Data.ASN1.Types.String
import           Data.Bits
import qualified Data.ByteArray                 as BA
import qualified Data.ByteString                as B
import qualified Data.ByteString.Char8          as C8
import qualified Data.ByteString.Base16         as B16
import           Data.Either
import           Data.Maybe
import           Data.PEM
import qualified Data.Text                      as T
import           Data.X509

import           Time.Types
import           Time.System





-----------------------------------------------------------------------------------------------
--------------------------------- TYPES AND TYPECLASS INSTANCES -------------------------------
-----------------------------------------------------------------------------------------------



newtype X509Certificate = X509Certificate SignedCertificate deriving (Show, Eq)


data Issuer = Issuer
  {
    issCommonName :: String
  , issCountry    :: String
  , issOrg        :: String
  , issUnit       :: String
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



instance ToJSON Subject where
  toJSON (Subject cn c o ou pub) = 
    object [ "commonName"       .= cn
           , "country"          .= c
           , "organization"     .= o
           , "organizationUnit" .= ou
           , "pubKey"           .= enc pub
           ]
     where enc = String . T.pack . C8.unpack . B16.encode . SEC.exportPubKey False  

-- TODO: country and unit should be optional?
instance FromJSON Subject where
  parseJSON (Object obj) = do
    cn  <- obj .: "commonName"
    c   <- obj .: "country"
    o   <- obj .: "organization"
    ou  <- obj .: "organizationUnit"
    pub <- obj .: "pubKey"
    return $ Subject cn c o ou (dec pub)
      where dec p = fromMaybe (error "could not decode pubkey") (SEC.importPubKey $ fst $ B16.decode $ C8.pack $ T.unpack p)
  parseJSON x = error $ "could not decode JSON subject info: " ++ show x


instance RLPSerializable X509Certificate where
  rlpEncode = RLPString . certToBytes
  
  rlpDecode (RLPString str) = fromRight (error "failed to rlpDecode cert") $ bsToCert str
  rlpDecode x = error $ "rlpDecode for SignedCertificate failed: expected RLPString, got " ++ show x

instance ToJSON X509Certificate where
  toJSON = String . T.pack . C8.unpack . certToBytes

instance FromJSON X509Certificate where
  parseJSON (String str) = return $ fromRight (error "failed to JSON parse cert") $ bsToCert $ C8.pack $ T.unpack str
  parseJSON x = error $ "parseJSON for SignedCertificate expects a String, but was given " ++ show x



----------------------------------------------------------------------------------------------
--------------------------------------- IMPORT/EXPORT ----------------------------------------
----------------------------------------------------------------------------------------------


certToBytes :: X509Certificate -> B.ByteString
certToBytes = pemWriteBS . certToPem

certToPem :: X509Certificate -> PEM
certToPem (X509Certificate cert) = PEM 
  { pemName = "CERTIFICATE"
  , pemHeader = []
  , pemContent = encodeSignedObject cert
  }


bsToCert :: B.ByteString -> Either String X509Certificate
bsToCert bs =
  case (pemParseBS bs) of
    Left str -> Left str
    Right [] -> Left "nothing parsed...but no errors?"
    Right (pem:_) -> 
      case (decodeSignedCertificate $ pemContent pem) of
        Left str -> Left str
        Right cert -> Right $ X509Certificate cert



--------------------------------------------------------------------------------------------
--------------------------------- CERT GENERATION AND SIGNING ------------------------------
--------------------------------------------------------------------------------------------



makeSignedCert :: Issuer -> Subject -> IO (X509Certificate)
makeSignedCert iss sub = makeCert iss sub >>= signCert (issPriv iss) >>= return . X509Certificate

signCert :: SEC.SecKey -> Certificate -> IO (SignedCertificate)
signCert priv cert = objectToSignedExactF (ecdsaWithSHA256 $ priv) cert

makeCert :: Issuer -> Subject -> IO (Certificate)
makeCert iss sub = do
--  serial <- (randomRIO (10000000, 99999999)) -- TODO: might we have repeat serials?
  serial' <- getEntropy 16
  let fromBytes = B.foldl' (\a b -> a `shiftL` 8 .|. fromIntegral b) 0
      serial = fromBytes serial'

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
  , (getObjectID DnOrganizationUnit, toASN1CS $ issUnit iss)
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



