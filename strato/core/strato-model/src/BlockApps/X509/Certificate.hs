{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}

module BlockApps.X509.Certificate
  ( X509Certificate (..),
    X509CertificateField (..),
    X509CertInfoState (..),
    CertificateChain (..),
    SignedCertificate,
    Issuer (..),
    Subject (..),
    x509CertToCertInfoState,
    HasSelectX509CertDB,
    HasSelectX509FieldDB,
    rootCert,
    certToBytes,
    bsToCert,
    makeCert,
    verifyCert,
    verifyCertAgainstCerts,
    verifyCertSignedBy,
    verifyBlockApps,
    verifyCertM,
    verifyBlockAppsM,
    makeSignedCert,
    makeSignedCertSigF,
    getCertSubject,
    getCertSubjects,
    getCertValidity,
    getCertIssuer,
    getCertIssuers,
    getParentUserAddress,
    findNodeCert,
    x509ToSigneds,
    signedsToX509,
    dateTimeToString,
    getValidity,
    getAddressFromCM,
    getX509FromAddress,
    getChainMemberFromX509,
  )
where

import BlockApps.X509.Keys
import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember hiding (commonName, orgName, orgUnit)
import Blockchain.Strato.Model.Secp256k1
import Control.Applicative ((<|>))
import Control.DeepSeq
import qualified Control.Lens as Lens
import Control.Lens.Operators hiding ((.=))
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Crypto.Hash
import qualified Crypto.Hash.Algorithms as CH
import Crypto.Random.Entropy
import qualified Crypto.Secp256k1 as SEC
import Data.ASN1.OID
import Data.ASN1.Types.String
import Data.Aeson
import Data.Binary
import Data.Bits
import qualified Data.ByteArray as BA
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Short as BSS
-- as Swag

import Data.Either
import Data.Functor
import Data.Hourglass
import Data.List (find)
import Data.Maybe
import Data.PEM
import qualified Data.Set as S
import Data.String
import Data.Swagger hiding (Format, format, get, put)
import Data.Swagger.Internal.Schema
import qualified Data.Text as T
import Data.Traversable
import Data.X509
import GHC.Generics
import Servant.Docs
import Test.QuickCheck
import qualified Text.Colors as CL
import Text.Format
import Time.System

-- import           Blockchain.Data.PubKey
-- import           Data.ASN1.Encoding
-- import           Data.ASN1.BinaryEncoding
-- import           Data.ASN1.Types

-----------------------------------------------------------------------------------------------
--------------------------------- TYPES AND TYPECLASS INSTANCES -------------------------------
-----------------------------------------------------------------------------------------------

newtype X509Certificate = X509Certificate CertificateChain deriving (Show, Eq)

newtype X509CertificateField = X509CertificateField String deriving (Show, Eq, Binary, Generic, Read, NFData)

type HasSelectX509CertDB m = (Address `A.Selectable` X509Certificate) m

type HasSelectX509FieldDB m = ((Address, T.Text) `A.Selectable` X509CertificateField) m

instance IsString X509CertificateField where
  fromString "" = X509CertificateField ""
  fromString s = X509CertificateField s

instance Ord X509Certificate where
  compare a b = compare (certToBytes a) (certToBytes b)

instance NFData X509Certificate where
  rnf (X509Certificate cert) = cert `seq` ()

instance Binary X509Certificate where
  put = (put :: C8.ByteString -> Put) <$> certToBytes
  get = (fromRight (error "The certificate couldn't be decoded") . bsToCert) <$> (get :: Get C8.ByteString)

-- | The information we store in Redis DB. We store the information of the certificate, as well
-- as the two state values `isValid` and `children`. We keep `userAddress` around for convenience,
-- as parsing the X509Certificate is non-deterministic.
data X509CertInfoState = X509CertInfoState
  { -- | The hash of the public key converted into an address
    userAddress :: Address,
    certificate :: X509Certificate,
    -- | Non-revoked = true, revoked = false
    isValid :: Bool,
    -- | The "userAddress" of the children of the certificate
    children :: [Address],
    orgName :: String,
    orgUnit :: Maybe String,
    commonName :: String
  }
  deriving (Show, Eq, Generic)

instance Ord X509CertInfoState where
    compare a b = compare (certificate a) (certificate b)

instance Binary X509CertInfoState where
    put = (put :: C8.ByteString -> Put) <$> certToBytes . certificate
    get = x509CertToCertInfoState <$> (fromRight (error "The certificate couldn't be decoded") . bsToCert) <$> (get :: Get C8.ByteString)

instance Format X509CertInfoState where
  format = show

instance Arbitrary X509Certificate where
  arbitrary = pure . X509Certificate $ CertificateChain []

instance Arbitrary X509CertInfoState where
  arbitrary =
    X509CertInfoState
      <$> arbitrary
      <*> arbitrary
      <*> arbitrary
      <*> arbitrary
      <*> arbitrary
      <*> arbitrary
      <*> arbitrary

signedsToX509 :: [SignedCertificate] -> X509Certificate
signedsToX509 = X509Certificate . CertificateChain

x509ToSigneds :: X509Certificate -> [SignedCertificate]
x509ToSigneds (X509Certificate (CertificateChain cs)) = cs

x509CertToCertInfoState :: X509Certificate -> X509CertInfoState
x509CertToCertInfoState cert =
  let sub = getCertSubject cert
      ua = maybe (Address 0) (fromPublicKey . subPub) sub
      o = maybe "" subOrg sub
      ou = maybe Nothing subUnit sub
      cn = maybe "" subCommonName sub
   in X509CertInfoState
        { userAddress = ua,
          certificate = cert,
          isValid = True,
          children = [],
          orgName = o,
          orgUnit = ou,
          commonName = cn
        }

getAddressFromCM :: ChainMemberParsedSet -> X509CertInfoState -> Maybe Address
getAddressFromCM (Everyone _) (X509CertInfoState ua _ _ _ _ _ _) = Just ua
getAddressFromCM (Org on _) (X509CertInfoState ua _ _ _ onx _ _) =
  if on == T.pack onx then Just ua else Nothing
getAddressFromCM (OrgUnit on ou _) (X509CertInfoState ua _ _ _ onx oux _) =
  if on == T.pack onx && ou == T.pack (fromMaybe "" oux) then Just ua else Nothing
getAddressFromCM (CommonName on ou cmn _) (X509CertInfoState ua _ _ _ onx oux cnmx) =
  if on == T.pack onx && ou == T.pack (fromMaybe "" oux) && cmn == T.pack cnmx then Just ua else Nothing

getChainMemberFromX509 :: X509CertInfoState -> ChainMemberParsedSet
getChainMemberFromX509 (X509CertInfoState _ _ _ _ on ou cname) = (CommonName (T.pack $ on) (T.pack (fromMaybe "" ou)) (T.pack $ cname) True)

getX509FromAddress ::
  A.Selectable Address X509CertInfoState m =>
  Address ->
  m (Maybe (X509CertInfoState))
getX509FromAddress addr = (A.select (A.Proxy @X509CertInfoState) addr)

data Issuer = Issuer
  { issCommonName :: String,
    issOrg :: String,
    issUnit :: Maybe String,
    issCountry :: Maybe String
  }
  deriving (Show, Eq)

instance Format Issuer where
  format = CL.magenta . show

data Subject = Subject
  { subCommonName :: String,
    subOrg :: String,
    subUnit :: Maybe String,
    subCountry :: Maybe String,
    subPub :: PublicKey
  }
  deriving (Show, Eq, Generic)

instance Format Subject where
  format = CL.blue . show

issuerEqSubject :: Issuer -> Subject -> Bool
issuerEqSubject Issuer {..} Subject {..} =
  (issCommonName, issOrg, issUnit, issCountry) == (subCommonName, subOrg, subUnit, subCountry)

instance ToJSON Subject where
  toJSON (Subject cn o ou c pub) =
    object
      [ "commonName" .= cn,
        "organization" .= o,
        "organizationUnit" .= ou,
        "country" .= c,
        "pubKey" .= pub
      ]

instance FromJSON Subject where
  parseJSON (Object obj) = do
    cn <- obj .: "commonName"
    o <- obj .: "organization"
    ou <- obj .:? "organizationUnit"
    c <- obj .:? "country"
    pub <- (either fail pure . bsToPub . C8.pack =<< (obj .: "pubKey")) <|> (obj .: "pubKey")
    return $ Subject cn o ou c pub
  parseJSON x = fail $ "could not decode JSON subject info: " ++ show x

instance ToSchema Subject where
  declareNamedSchema proxy =
    genericDeclareNamedSchema defaultSchemaOptions proxy
      & Lens.mapped . name ?~ "Subject for a X.509 certificate"
      & Lens.mapped . schema . example ?~ toJSON ex
    where
      ex :: Subject
      ex =
        Subject
          { subCommonName = "John Smith",
            subOrg = "BlockApps Inc.",
            subUnit = Just "Engineering",
            subCountry = Just "USA",
            subPub = fromMaybe undefined $ importPublicKey "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEGOKeu5dSCBFHVQuy/q1A8BeTb99G83tD\nVecvHHne6sKfmBZN1AIjhpHGKO22vBfdq3dMn/QBqb2TdR9w3WvMXQ==\n-----END PUBLIC KEY-----\n"
          }

instance RLPSerializable X509Certificate where
  rlpEncode = RLPString . certToBytes

  rlpDecode (RLPString str) = fromRight (error "failed to rlpDecode cert") $ bsToCert str
  rlpDecode x = error $ "rlpDecode for SignedCertificate failed: expected RLPString, got " ++ show x

instance RLPSerializable (S.Set X509Certificate) where
  rlpEncode s = RLPArray $ rlpEncode <$> (S.toList s)

  rlpDecode (RLPArray cs) = S.fromList (rlpDecode <$> cs)
  rlpDecode x = error $ "rlpDecode for SignedCertificate Set failed: expected RLPArray, got " ++ show x

instance ToJSON X509Certificate where
  toJSON = String . T.pack . C8.unpack . certToBytes

instance FromJSON X509Certificate where
  parseJSON (String str) =
    let errDump err = fail $ "failed to JSON parse cert " ++ (show str) ++ " because " ++ err
     in either (errDump) pure $ bsToCert $ C8.pack $ T.unpack str
  parseJSON x = fail $ "parseJSON for SignedCertificate expects a String, but was given " ++ show x

instance ToSchema X509Certificate where
  declareNamedSchema = const . pure $ named "X509Certificate bytestring" binarySchema

instance ToSample X509Certificate where
  toSamples _ =
    singleSample . fromRight (error "NOOO! 😨") . bsToCert . C8.pack $
      unlines
        [ "-----BEGIN CERTIFICATE-----",
          "MIIBjDCCATCgAwIBAgIRAIs9fXiIfXIZ22paA1BYggYwDAYIKoZIzj0EAwIFADBH",
          "MQ0wCwYDVQQDDARMdWtlMRIwEAYDVQQKDAlCbG9ja2FwcHMxFDASBgNVBAsMC2Vu",
          "Z2luZWVyaW5nMQwwCgYDVQQGDANVU0EwHhcNMjIwODIzMjAwODQxWhcNMjMwODIz",
          "MjAwODQxWjBHMQ0wCwYDVQQDDARMdWtlMRIwEAYDVQQKDAlCbG9ja2FwcHMxFDAS",
          "BgNVBAsMC2VuZ2luZWVyaW5nMQwwCgYDVQQGDANVU0EwVjAQBgcqhkjOPQIBBgUr",
          "gQQACgNCAASxPPKgsG0NJu0tNwIfIKOrCnbKgA5PeMuIejm48GXKPgf4Tgtb3hOM",
          "wF+PQU9vFtxC8gEbKv/aLn0U+EvS4F1nMAwGCCqGSM49BAMCBQADSAAwRQIhAPkX",
          "DGxjCRln4lpSC5DtEGNKkepfkeNuyWzHcBCRyb2KAiAtIUIWWBO3qpCsVILHiD1T",
          "56hQTEUFjrewBNx+JTQavA==",
          "-----END CERTIFICATE-----",
          "-----BEGIN CERTIFICATE-----",
          "MIIBizCCAS+gAwIBAgIQahwA5iOvvZh0/1f2zxtxDjAMBggqhkjOPQQDAgUAMEcx",
          "DTALBgNVBAMMBEx1a2UxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIGA1UECwwLZW5n",
          "aW5lZXJpbmcxDDAKBgNVBAYMA1VTQTAeFw0yMjA4MDkxNTA4MzhaFw0yMzA4MDkx",
          "NTA4MzhaMEcxDTALBgNVBAMMBEx1a2UxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIG",
          "A1UECwwLZW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuB",
          "BAAKA0IABEo5L1XbwQ0kqrM+61HydxVCvANUVncjqXxYGvMsaBgHc8QS4BF6GQQD",
          "OILDJkfREUkRW0wT3kQXhcjVLRVdYeAwDAYIKoZIzj0EAwIFAANIADBFAiEAw/oq",
          "6/T+yHQoKuvCg6MMQoth/F0JrFlPtGyM+auYPTECIEHbiDKXbaF2rhXBeEJFgZX1",
          "prz3Yc03zv5VJ5rP/55A",
          "-----END CERTIFICATE-----"
        ]

----------------------------------------------------------------------------------------------
---------------------------------------- ROOT CERT -------------------------------------------
----------------------------------------------------------------------------------------------

rootCert :: X509Certificate
rootCert =
  let eCert =
        bsToCert $
          C8.pack $
            unlines
              [ "-----BEGIN CERTIFICATE-----",
                "MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI",
                "MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF",
                "bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy",
                "MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU",
                "MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG",
                "BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs",
                "9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8",
                "R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n",
                "N8txKc8G9R27ZYAUuz15zF0=",
                "-----END CERTIFICATE-----"
              ]
   in case eCert of
        Left _ -> error "Somehow, Palpatine has returned"
        Right c -> c

----------------------------------------------------------------------------------------------
--------------------------------------- IMPORT/EXPORT ----------------------------------------
----------------------------------------------------------------------------------------------
certToBytes :: X509Certificate -> B.ByteString
certToBytes cert = C8.concat $ pemWriteBS . signedCertToPem <$> x509ToSigneds cert

signedCertToPem :: SignedCertificate -> PEM
signedCertToPem cert =
  PEM
    { pemName = "CERTIFICATE",
      pemHeader = [],
      pemContent = encodeSignedObject cert
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

makeSignedCert :: (MonadIO m, HasVault m) => Maybe DateTime -> Maybe X509Certificate -> Issuer -> Subject -> m (X509Certificate)
makeSignedCert mDateTime parentCert iss sub = makeCert mDateTime iss sub >>= signCert >>= return . X509Certificate . CertificateChain . (: (join . maybeToList $ x509ToSigneds <$> parentCert))

signCert :: (MonadIO m, HasVault m) => Certificate -> m (SignedCertificate)
signCert cert = objectToSignedExactF (ecdsaWithSHA256) cert

makeCert :: MonadIO m => Maybe DateTime -> Issuer -> Subject -> m (Certificate)
makeCert mDateTime iss sub = do
  serial' <- liftIO $ getEntropy 16
  let fromBytes = B.foldl' (\a b -> a `shiftL` 8 .|. fromIntegral b) 0
      serial = fromBytes serial'

  validity <- case mDateTime of
    Nothing -> liftIO getValidity
    Just dateTime -> do
      (DateTime dt tm') <- liftIO dateCurrent
      let curDate@(DateTime _ _) = DateTime dt tm' {todNSec = 0}
      return (curDate, dateTime)

  return
    Certificate
      { certVersion = 0x02,
        certSerial = serial,
        certSignatureAlg = SignatureALG HashSHA256 PubKeyALG_EC,
        certIssuerDN = getIssuerDN iss,
        certValidity = validity,
        certSubjectDN = getSubjectDN sub,
        certPubKey = getCertPub sub,
        certExtensions = Extensions Nothing
      }

-- Data.X509's objectToSignedExact function expects a signing function with signature
-- B.ByteString -> f (B.ByteString, SignatureALG), and assumes that you will hash the
-- bytestring message, so hence this function. We partially apply the privkey when we
-- pass it to objectToSignedExact
--
-- yea, I wish we could use Keccak256. Data.X509 hasn't caught up yet. Maybe I'll
-- make a PR for it
ecdsaWithSHA256 :: (MonadIO m, HasVault m) => B.ByteString -> m (B.ByteString, SignatureALG)
ecdsaWithSHA256 = ecdsaWithSHA256F sign

makeSignedCertSigF ::
  (MonadIO m) =>
  (B.ByteString -> m Signature) -> -- Signature function
  Maybe DateTime -> -- Expiry date
  Maybe X509Certificate -> -- Parent certificate to append
  Issuer -> -- Certificate issuer
  Subject -> -- Certificate subject
  m (Maybe X509Certificate) -- The resulting certificate (Nothing if signing failed)
makeSignedCertSigF signF mDateTime parentCert iss sub = do
  unsignedCert <- makeCert mDateTime iss sub
  signedCert <- objectToSignedExactF (ecdsaWithSHA256F signF) unsignedCert
  return . Just . X509Certificate . CertificateChain . (: (join . maybeToList $ x509ToSigneds <$> parentCert)) $ signedCert

ecdsaWithSHA256F :: MonadIO m => (B.ByteString -> m Signature) -> B.ByteString -> m (B.ByteString, SignatureALG)
ecdsaWithSHA256F signF mesg' = do
  let mesgBS = B.pack $ BA.unpack $ hashWith CH.SHA256 mesg'
  Signature (SEC.CompactRecSig r s v) <- signF mesgBS
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
        [ (getObjectID DnCommonName, Just $ issCommonName iss),
          (getObjectID DnOrganization, Just $ issOrg iss),
          (getObjectID DnOrganizationUnit, issUnit iss),
          (getObjectID DnCountry, issCountry iss)
        ]
   in DistinguishedName $ map (fmap toASN1CS) . catMaybes $ sequence <$> mList

getSubjectDN :: Subject -> DistinguishedName
getSubjectDN sub =
  let mList =
        [ (getObjectID DnCommonName, Just $ subCommonName sub),
          (getObjectID DnOrganization, Just $ subOrg sub),
          (getObjectID DnOrganizationUnit, subUnit sub),
          (getObjectID DnCountry, subCountry sub)
        ]
   in DistinguishedName $ map (fmap toASN1CS) . catMaybes $ sequence <$> mList

getValidity :: IO (DateTime, DateTime)
getValidity = do
  (DateTime dt tm') <- dateCurrent
  let curDate@(DateTime _ tm) = DateTime dt tm' {todNSec = 0} -- need to wipe out nanseconds b/c they won't serialize
      oneYear = Period {periodYears = 1, periodMonths = 0, periodDays = 0}
      endDate = DateTime (dt `dateAddPeriod` oneYear) tm -- all certs are valid for a year
  return (curDate, endDate)

dateTimeToString :: DateTime -> String
dateTimeToString = show . timeGetElapsed

getParentUserAddress :: X509Certificate -> Maybe Address
getParentUserAddress (X509Certificate (CertificateChain (_ : c2 : _))) = fmap (fromPublicKey . subPub) (getCertSubject (X509Certificate (CertificateChain [c2])))
getParentUserAddress _ = Nothing

getCertPub :: Subject -> PubKey
getCertPub = serializeAndWrap . subPub

-- Get the (first) subject of the certificate
getCertSubject :: X509Certificate -> Maybe Subject
getCertSubject cert = listToMaybe =<< getCertSubjects cert

-- without cn and org, subject and issuer are invalid, but the other fields can be Nothing
getCertSubjects :: X509Certificate -> Maybe [Subject]
getCertSubjects certs = for (x509ToSigneds certs) $ \cert -> do
  pubKey <- unserializeAndUnwrap . certPubKey $ getCertificate cert
  cn <- extractDn cert DnCommonName
  org <- extractDn cert DnOrganization
  return $
    Subject
      { subCommonName = cn,
        subOrg = org,
        subUnit = extractDn cert DnOrganizationUnit,
        subCountry = extractDn cert DnCountry,
        subPub = pubKey
      }
  where
    extractDn :: SignedCertificate -> DnElement -> Maybe String
    extractDn cert dn = fmap fromASN1CS . getDnElement dn . certSubjectDN $ getCertificate cert

getCertValidity :: X509Certificate -> (DateTime, DateTime)
getCertValidity (X509Certificate (CertificateChain (c : _))) = certValidity cert
  where
    (Signed cert _ _) = getSigned c
getCertValidity (X509Certificate (_)) = error "Cannot get the validity period of an empty certificate"

--To write this function we need to convert our X509Certificate into a Certificate to use the certValidity function?
-- using c :: SignedExact Certificate ? location of this function? only mentioned in this file?

getCertIssuer :: X509Certificate -> Maybe Issuer
getCertIssuer cert = listToMaybe =<< getCertIssuers cert

getCertIssuers :: X509Certificate -> Maybe [Issuer]
getCertIssuers certs = for (x509ToSigneds certs) $ \cert -> do
  cn <- extractDn cert DnCommonName
  org <- extractDn cert DnOrganization
  return $
    Issuer
      { issCommonName = cn,
        issOrg = org,
        issUnit = extractDn cert DnOrganizationUnit,
        issCountry = extractDn cert DnCountry
      }
  where
    extractDn :: SignedCertificate -> DnElement -> Maybe String
    extractDn cert dn = fmap fromASN1CS . getDnElement dn . certIssuerDN $ getCertificate cert

--------------------------------------------------------------------------------------------
------------------------------------- CERT VERIFICATION ------------------------------------
--------------------------------------------------------------------------------------------

-- Verify that a cert was signed by given public key
-- We perform a chain validation and expect pkey to be our trust anchor. The process is
-- combersomly detailed in RFC 5280 section 6
-- The first certificate in X509Certificate is the target cert, and the last one is the
-- the trust anchor (the one signed by the public key)
verifyCertAgainstCerts :: [X509Certificate] -> X509Certificate -> Bool
verifyCertAgainstCerts certs cert = any (`verifyCert` cert) pkeys
  where
    pkeys = fmap subPub . catMaybes . fmap getCertSubject $ certs

verifyCert :: PublicKey -> X509Certificate -> Bool
verifyCert pkey (X509Certificate (CertificateChain cs)) = verifyCertChain pkey cs

verifyCertSignedBy :: PublicKey -> X509Certificate -> Bool
verifyCertSignedBy pkey (X509Certificate (CertificateChain (c : _))) =
  let signed = getSigned c
      mesgBS = B.pack $ BA.unpack $ hashWith CH.SHA256 (getSignedData c)
   in case importSignature' $ signedSignature signed of
        Nothing -> False
        Just sig -> verifySig pkey sig mesgBS
verifyCertSignedBy _ _ = False ---error ("Cannot verify cert " <> show cs <> " against " <> show pkey)

verifyCertChain :: PublicKey -> [SignedCertificate] -> Bool
verifyCertChain _ [] = False
verifyCertChain pkey [c] =
  let signed = getSigned c
      mesgBS = B.pack $ BA.unpack $ hashWith CH.SHA256 (getSignedData c)
   in case importSignature' $ signedSignature signed of
        Nothing -> False
        Just sig -> verifySig pkey sig mesgBS
verifyCertChain pkey (c : c' : cs) = issuerMatchesSubject c c' && signedBy c c' && verifyCertChain pkey (c' : cs)

-- Verify that c's issuer match c''s subject
issuerMatchesSubject :: SignedCertificate -> SignedCertificate -> Bool
issuerMatchesSubject c c' = fromMaybe False $ issuerEqSubject <$> getCertIssuer (signedsToX509 [c]) <*> getCertSubject (signedsToX509 [c'])

-- Verify that c signed by c'
signedBy :: SignedCertificate -> SignedCertificate -> Bool
signedBy c c' = fromMaybe False $ (\k -> verifyCertChain k [c]) . subPub <$> getCertSubject (signedsToX509 [c'])

verifyBlockApps :: X509Certificate -> Bool
verifyBlockApps = verifyCert rootPubKey

verifyBlockAppsM :: MonadIO m => m X509Certificate -> m Bool
verifyBlockAppsM = fmap verifyBlockApps

verifyCertM :: MonadIO m => PublicKey -> X509Certificate -> m Bool
verifyCertM pkey (X509Certificate (CertificateChain cs)) = mapM_ printCertDetails cs $> verifyCertChain pkey cs
  where
    printCertDetails :: MonadIO m => SignedCertificate -> m ()
    printCertDetails c = do
      let signed = getSigned c
          mesgBS = B.pack $ BA.unpack $ hashWith CH.SHA256 (getSignedData c)
          (Signature (SEC.CompactRecSig r s _)) = fromMaybe (error "Could not decode signature from DER format") (importSignature' $ signedSignature signed)
      liftIO $ putStrLn $ format (getCertIssuer $ signedsToX509 [c])
      liftIO $ putStrLn $ "Signature:"
      liftIO $ putStrLn $ "   R: " ++ (show $ B16.encode $ BSS.fromShort r)
      liftIO $ putStrLn $ "   S: " ++ (show $ B16.encode $ BSS.fromShort s)
      liftIO $ putStrLn $ "Signature (DER Encoding): " ++ (show $ B16.encode $ signedSignature signed)
      liftIO $ putStrLn $ "Certificate Hash: " ++ (show $ B16.encode mesgBS)

      case getCertSubject $ signedsToX509 [c] of
        Nothing -> liftIO $ putStrLn $ "No Subject"
        Just subject -> do
          liftIO $ putStrLn $ format subject
          liftIO $ putStrLn $ "Subject Address: " ++ (format $ fromPublicKey $ subPub subject)

-- Find a matching pubkey in a list of signed certs
findNodeCert :: PublicKey -> [SignedCertificate] -> Maybe SignedCertificate
findNodeCert pk = find (\x -> unserializeAndUnwrap (certPubKey (signedObject (getSigned x))) == Just pk)
