{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE OverloadedStrings #-}
-- {-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}


module BlockApps.X509.Certificate (
  X509Certificate(..),
  Issuer(..),
  Subject(..),
  certToBytes, 
  bsToCert,
  makeCert,
  makeSignedCert,
  getCertSubject,
  getCertIssuer
 ) where




import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Secp256k1
import           BlockApps.X509.Keys

import           Control.Monad.IO.Class
import           Crypto.Random.Entropy
import           Crypto.Hash
import qualified Crypto.Hash.Algorithms             as CH
import qualified Crypto.Secp256k1                   as SEC

import           Data.Aeson
import           Data.ASN1.OID
import           Data.ASN1.Types.String
import           Data.Bits
import qualified Data.ByteArray                     as BA
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Char8              as C8
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
  , issOrg        :: String
  , issUnit       :: Maybe String
  , issCountry    :: Maybe String
  } deriving (Show, Eq)


data Subject = Subject
  {
    subCommonName :: String
  , subOrg        :: String
  , subUnit       :: Maybe String
  , subCountry    :: Maybe String
  , subPub        :: PublicKey
  } deriving (Show, Eq)



instance ToJSON Subject where
  toJSON (Subject cn c o ou pub) = 
    object [ "commonName"       .= cn
           , "organization"     .= o
           , "organizationUnit" .= ou
           , "country"          .= c
           , "pubKey"           .= pub
           ]

instance FromJSON Subject where
  parseJSON (Object obj) = do
    cn  <- obj .: "commonName"
    o   <- obj .: "organization"
    ou  <- obj .:? "organizationUnit"
    c   <- obj .:? "country"
    pub <- obj .: "pubKey"
    return $ Subject cn o ou c pub
  
  parseJSON x = fail $ "could not decode JSON subject info: " ++ show x


instance RLPSerializable X509Certificate where
  rlpEncode = RLPString . certToBytes
  
  rlpDecode (RLPString str) = fromRight (error "failed to rlpDecode cert") $ bsToCert str
  rlpDecode x = error $ "rlpDecode for SignedCertificate failed: expected RLPString, got " ++ show x

instance ToJSON X509Certificate where
  toJSON = String . T.pack . C8.unpack . certToBytes

instance FromJSON X509Certificate where
  parseJSON (String str) = either (fail "failed to JSON parse cert") pure $ bsToCert $ C8.pack $ T.unpack str
  parseJSON x = fail $ "parseJSON for SignedCertificate expects a String, but was given " ++ show x



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



makeSignedCert :: (MonadIO m, HasVault m) => Issuer -> Subject -> m (X509Certificate)
makeSignedCert iss sub = makeCert iss sub >>= signCert >>= return . X509Certificate

signCert :: (MonadIO m, HasVault m) => Certificate -> m (SignedCertificate)
signCert cert = objectToSignedExactF (ecdsaWithSHA256) cert

makeCert :: MonadIO m => Issuer -> Subject -> m (Certificate)
makeCert iss sub = do
  serial' <- liftIO $ getEntropy 16
  let fromBytes = B.foldl' (\a b -> a `shiftL` 8 .|. fromIntegral b) 0
      serial = fromBytes serial'

  validity <- liftIO getValidity
  

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
ecdsaWithSHA256 :: (MonadIO m, HasVault m) => B.ByteString -> m (B.ByteString, SignatureALG)
ecdsaWithSHA256 mesg' = do
  let mesgBS = B.pack $ BA.unpack $ hashWith CH.SHA256 mesg'
  Signature (SEC.CompactRecSig s r v) <- sign mesgBS
  
  -- I too hate that we have to do this r,s swap....but strato-model swaps it because Ethereum
  -- swaps it, and cert validation will fail if we leave them swapped here, so we swap it back
  let sig'' = SEC.CompactRecSig r s v 
      sig' = fromMaybe (error "could not read a sig we just made") (SEC.importCompactRecSig sig'')
      sig = SEC.convertRecSig sig' -- drop the 'v'
  return (SEC.exportSig sig, SignatureALG HashSHA256 PubKeyALG_EC)



toASN1CS :: String -> ASN1CharacterString
toASN1CS = asn1CharacterString UTF8


fromASN1CS :: ASN1CharacterString -> String
fromASN1CS cs = 
  let errstr = "failed to decode ASN1CharacterString: " ++ show cs
  in fromMaybe (error errstr) (asn1CharacterToString cs)


getIssuerDN :: Issuer -> DistinguishedName
getIssuerDN iss = 
  let mList = 
        [ (getObjectID DnCommonName, Just $ issCommonName iss)
        , (getObjectID DnOrganization, Just $ issOrg iss)
        , (getObjectID DnOrganizationUnit, issUnit iss)
        , (getObjectID DnCountry, issCountry iss)
        
  in DistinguishedName $ map (fmap toASN1CS) . catMaybes $ sequence <$> mList 
 
getSubjectDN :: Subject -> DistinguishedName
getSubjectDN sub =
  let mList =   
        [ (getObjectID DnCommonName, Just $ subCommonName sub)
        , (getObjectID DnOrganization, Just $ subOrg sub)
        , (getObjectID DnOrganizationUnit, subUnit sub)
        , (getObjectID DnCountry, subCountry sub)
        ]
  in DistinguishedName $ map (fmap toASN1CS) . catMaybes $ sequence <$> mList 

getValidity :: IO (DateTime, DateTime)
getValidity = do
  (DateTime dt tm') <- dateCurrent
  let curDate@(DateTime _ tm) = DateTime dt tm'{todNSec = 0} -- need to wipe out nanseconds b/c they won't serialize
      endDate = DateTime dt{dateYear=(dateYear dt) + 1} tm -- all certs are valid for a year
  return (curDate, endDate)
 


getCertPub :: Subject -> PubKey
getCertPub = serializeAndWrap . subPub


-- without cn and org, subject and issuer are invalid, but the other fields can be Nothing
getCertSubject :: X509Certificate -> Maybe Subject
getCertSubject (X509Certificate cert) = do
  pubKey <- unserializeAndUnwrap . certPubKey $ getCertificate cert
  cn     <- extractDn DnCommonName
  org    <- extractDn DnOrganization
  return $ Subject { subCommonName = cn
                   , subOrg        = org
                   , subUnit       = extractDn DnOrganizationUnit
                   , subCountry    = extractDn DnCountry
                   , subPub        = pubKey 
                   }
  where extractDn :: DnElement -> Maybe String
        extractDn dn = fmap fromASN1CS . getDnElement dn . certSubjectDN $ getCertificate cert   

getCertIssuer :: X509Certificate -> Maybe Issuer
getCertIssuer (X509Certificate cert) = do
  cn     <- extractDn DnCommonName
  org    <- extractDn DnOrganization
  return $ Issuer { issCommonName = cn
                  , issOrg        = org
                  , issUnit       = extractDn DnOrganizationUnit 
                  , issCountry    = extractDn DnCountry
                  }
  where extractDn :: DnElement -> Maybe String
        extractDn dn = fmap fromASN1CS . getDnElement dn . certSubjectDN $ getCertificate cert    
