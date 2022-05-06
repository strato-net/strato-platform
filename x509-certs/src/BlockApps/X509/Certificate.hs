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
  rootCert,
  certToBytes, 
  bsToCert,
  makeCert,
  verifyCert,
  verifyBlockApps,
  verifyCertM,
  makeSignedCert,
  getCertSubject,
  getCertIssuer
 ) where



import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.Address
import           BlockApps.X509.Keys
import           Control.DeepSeq
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
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Short              as BSS

import           Data.Functor
import           Data.Either
import           Data.Maybe
import           Data.PEM
import qualified Data.Text                      as T
import           Data.X509
import           Data.Traversable
import           Time.Types
import           Time.System
import qualified Text.Colors       as CL
import           Text.Format

-- import           Data.ASN1.Encoding
-- import           Data.ASN1.BinaryEncoding
-- import           Data.ASN1.Types

-----------------------------------------------------------------------------------------------
--------------------------------- TYPES AND TYPECLASS INSTANCES -------------------------------
-----------------------------------------------------------------------------------------------



newtype X509Certificate = X509Certificate CertificateChain deriving (Show, Eq)

instance NFData X509Certificate where
    rnf (X509Certificate cert) = cert `seq` ()


data Issuer = Issuer
  {
    issCommonName :: String
  , issOrg        :: String
  , issUnit       :: Maybe String
  , issCountry    :: Maybe String
  } deriving (Show, Eq)

instance Format Issuer where
  format = CL.magenta . show
data Subject = Subject
  {
    subCommonName :: String
  , subOrg        :: String
  , subUnit       :: Maybe String
  , subCountry    :: Maybe String
  , subPub        :: PublicKey
  } deriving (Show, Eq)

instance Format Subject where
  format = CL.blue . show


instance ToJSON Subject where
  toJSON (Subject cn o ou c pub) = 
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
  parseJSON (String str) = 
    let errDump err = fail $ "failed to JSON parse cert " ++ (show str) ++ " because " ++ err 
    in either (errDump) pure $ bsToCert $ C8.pack $ T.unpack str
  parseJSON x = fail $ "parseJSON for SignedCertificate expects a String, but was given " ++ show x

----------------------------------------------------------------------------------------------
---------------------------------------- ROOT CERT -------------------------------------------
----------------------------------------------------------------------------------------------

rootCert :: X509Certificate
rootCert = let eCert = bsToCert $ C8.pack $ unlines
                [ "-----BEGIN CERTIFICATE-----"
                , "MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI"
                , "MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF"
                , "bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy"
                , "MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU"
                , "MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG"
                , "BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs"
                , "9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8"
                , "R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n"
                , "N8txKc8G9R27ZYAUuz15zF0="
                , "-----END CERTIFICATE-----"
                ]
            in case eCert of 
              Left _ -> error "Somehow, Palpatine has returned"
              Right c -> c

----------------------------------------------------------------------------------------------
--------------------------------------- IMPORT/EXPORT ----------------------------------------
----------------------------------------------------------------------------------------------

certToBytes :: X509Certificate -> B.ByteString
certToBytes x = C8.concat . fmap pemWriteBS . certsToPems $ x

certsToPems :: X509Certificate -> [PEM]
certsToPems (X509Certificate (CertificateChain certs)) = certs <&> \c -> PEM 
  { pemName = "CERTIFICATE"
  , pemHeader = []
  , pemContent = encodeSignedObject c
  }


bsToCert :: B.ByteString -> Either String X509Certificate
bsToCert bs =
  case (pemParseBS bs) of
    Left str -> Left str
    Right [] -> Left "nothing parsed...but no errors?"
    Right pems -> 
      case (decodeCertificateChain $ CertificateChainRaw $ pemContent <$> pems) of
        Left (i, str) -> Left $ str <> " : cert " <> show i
        Right cert -> Right $ X509Certificate cert



--------------------------------------------------------------------------------------------
--------------------------------- CERT GENERATION AND SIGNING ------------------------------
--------------------------------------------------------------------------------------------



makeSignedCert :: (MonadIO m, HasVault m) => Issuer -> Subject -> m (X509Certificate)
makeSignedCert iss sub = makeCert iss sub >>= signCert >>= return . X509Certificate . CertificateChain . (\x -> [x])

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
  Signature (SEC.CompactRecSig r s v) <- sign mesgBS
  -- I too hate that we have to do this r, s swap....but strato-model swaps it because Ethereum
  -- swaps it, and cert validation will fail if we leave them swapped here, so we swap it back
  let sig'' = SEC.CompactRecSig s r v 
      sig' = fromMaybe (error "could not read a sig we just made") (SEC.importCompactRecSig sig'')
      sig = SEC.convertRecSig sig' -- Drop the 'v' because the ASN1 protocol does not support recoverable signatures
  return (SEC.exportSig sig, SignatureALG HashSHA256 PubKeyALG_EC)



toASN1CS :: String -> ASN1CharacterString
toASN1CS = asn1CharacterString UTF8


fromASN1CS :: ASN1CharacterString -> String
fromASN1CS cs = 
  let errstr = "failed to decode ASN1CharacterString: " ++ show cs
  in fromMaybe errstr (asn1CharacterToString cs)


getIssuerDN :: Issuer -> DistinguishedName
getIssuerDN iss = 
  let mList =
        [ (getObjectID DnCommonName, Just $ issCommonName iss)
        , (getObjectID DnOrganization, Just $ issOrg iss)
        , (getObjectID DnOrganizationUnit, issUnit iss)
        , (getObjectID DnCountry, issCountry iss)
        ]
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
getCertSubject :: X509Certificate -> Maybe [Subject]
getCertSubject (X509Certificate (CertificateChain certs)) = for certs $ \cert -> do
  pubKey <- unserializeAndUnwrap . certPubKey $ getCertificate cert
  cn     <- extractDn cert DnCommonName
  org    <- extractDn cert DnOrganization
  return $ Subject { subCommonName = cn
                   , subOrg        = org
                   , subUnit       = extractDn cert DnOrganizationUnit
                   , subCountry    = extractDn cert DnCountry
                   , subPub        = pubKey 
                   }
  where extractDn :: SignedCertificate -> DnElement -> Maybe String
        extractDn cert dn = fmap fromASN1CS . getDnElement dn . certSubjectDN $ getCertificate cert   

getCertIssuer :: X509Certificate -> Maybe [Issuer]
getCertIssuer (X509Certificate (CertificateChain certs)) = for certs $ \cert -> do
  cn     <- extractDn cert DnCommonName
  org    <- extractDn cert DnOrganization
  return $ Issuer { issCommonName = cn
                  , issOrg        = org
                  , issUnit       = extractDn cert DnOrganizationUnit 
                  , issCountry    = extractDn cert DnCountry
                  }
  where extractDn :: SignedCertificate -> DnElement -> Maybe String
        extractDn cert dn = fmap fromASN1CS . getDnElement dn . certIssuerDN $ getCertificate cert


--------------------------------------------------------------------------------------------
------------------------------------- CERT VERIFICATION ------------------------------------
--------------------------------------------------------------------------------------------

-- Verify that a cert was signed by given public key
-- We perform a chain validation and expect pkey to be our trust anchor. The process is 
-- combersomly detailed in RFC 5280 section 6
-- The first certificate in X509Certificate is the target cert, and the last one is the
-- the trust anchor (the one signed by the public key)
verifyCert :: PublicKey -> X509Certificate -> Bool
verifyCert _ (X509Certificate (CertificateChain [])) = False
verifyCert pkey (X509Certificate (CertificateChain [c])) = 
  let signed = getSigned c
      mesgBS = B.pack $ BA.unpack $ hashWith CH.SHA256 (getSignedData c)
  in
  case importSignature' $ signedSignature signed of 
    Nothing -> False
    Just sig -> verifySig pkey sig mesgBS
verifyCert pkey (X509Certificate (CertificateChain (c:c':cs))) = 
  and [
      getCertIssuer (X509Certificate (CertificateChain [c])) `issSubEq` getCertSubject (X509Certificate (CertificateChain [c]))
    , c `signedBy` c'
    , verifyCert pkey (X509Certificate (CertificateChain (c':cs)))
  ]
  where issSubEq :: Maybe [Issuer] -> Maybe [Subject] -> Bool
        issSubEq (Just [Issuer{..}]) (Just [Subject{..}]) = 
          (issCommonName, issOrg, issUnit, issCountry) == (subCommonName, subOrg, subUnit, subCountry)
        issSubEq _ _ = False

        signedBy :: SignedCertificate -> SignedCertificate -> Bool
        signedBy sc sc' = case sc'pubKey of
            Nothing -> False
            Just sc'pkey -> verifyCert sc'pkey (X509Certificate (CertificateChain [sc]))
          where sc'pubKey :: Maybe PublicKey
                sc'pubKey = fmap subPub $ listToMaybe =<< getCertSubject (X509Certificate (CertificateChain [sc']))

verifyBlockApps :: X509Certificate -> Bool 
verifyBlockApps = verifyCert rootPubKey

verifyCertM :: MonadIO m => PublicKey -> X509Certificate -> m Bool
verifyCertM _ (X509Certificate (CertificateChain [])) = pure False
verifyCertM pkey cert@(X509Certificate (CertificateChain [c])) = do
  let signed    = getSigned c
      mesgBS    = B.pack $ BA.unpack $ hashWith CH.SHA256 (getSignedData c)
      signature@(Signature (SEC.CompactRecSig r s _)) = fromMaybe (error "Could not decode signature from DER format") (importSignature' $ signedSignature signed)
      isValid   = verifySig pkey signature mesgBS
  liftIO $ putStrLn $ format (getCertIssuer cert)
  liftIO $ putStrLn $ "Signature:"
  liftIO $ putStrLn $ "   R: " ++ (show $ B16.encode $ BSS.fromShort r)
  liftIO $ putStrLn $ "   S: " ++ (show $ B16.encode $ BSS.fromShort s)
  liftIO $ putStrLn $ "Signature (DER Encoding): " ++ (show $ B16.encode $ signedSignature signed )
  liftIO $ putStrLn $ "Certificate Hash: " ++ (show $ B16.encode mesgBS)
  
  case getCertSubject cert of 
    Nothing -> liftIO $ putStrLn $ "No Subject"
    Just [] -> liftIO $ putStrLn $ "No Subject"
    Just (subject:_) -> do 
      liftIO $ putStrLn $ format subject
      liftIO $ putStrLn $ "Subject Address: " ++ (format $ fromPublicKey $ subPub subject) 
  return isValid
verifyCertM pkey (X509Certificate (CertificateChain (c:c':cs))) = do
  rec <- verifyCertM pkey (X509Certificate (CertificateChain (c':cs)))
  sig <- c `signedBy` c'
  return $ and [
        getCertIssuer (X509Certificate (CertificateChain [c])) `issSubEq` getCertSubject (X509Certificate (CertificateChain [c]))
      , sig
      , rec
    ]
  where issSubEq :: Maybe [Issuer] -> Maybe [Subject] -> Bool
        issSubEq (Just [Issuer{..}]) (Just [Subject{..}]) = 
          (issCommonName, issOrg, issUnit, issCountry) == (subCommonName, subOrg, subUnit, subCountry)
        issSubEq _ _ = False

        signedBy :: MonadIO m => SignedCertificate -> SignedCertificate -> m Bool
        signedBy sc sc' = case sc'pubKey of
            Nothing -> pure False
            Just sc'pkey -> verifyCertM sc'pkey (X509Certificate (CertificateChain [sc]))
          where sc'pubKey :: Maybe PublicKey
                sc'pubKey = fmap subPub $ listToMaybe =<< getCertSubject (X509Certificate (CertificateChain [sc']))

  