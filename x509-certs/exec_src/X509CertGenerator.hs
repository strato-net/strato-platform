{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE BangPatterns    #-}
{-# LANGUAGE RecordWildCards #-}

import           Control.Exception
import qualified Crypto.Secp256k1           as SEC

import qualified Data.Aeson                 as Ae
import qualified Data.ByteString            as B
import qualified Data.ByteString.Char8      as C8
import           Data.Either
import           Data.Foldable              (foldlM)
import           Data.Maybe
import           System.Console.GetOpt
import           System.Environment


import           BlockApps.X509 



--------------------------------------------------------------------------------------------
----------------------------------------- ARGS ---------------------------------------------
--------------------------------------------------------------------------------------------

data Options = Options 
  { optIssuerCert    :: Maybe X509Certificate
  , optSubjectInfo   :: Subject
  , optKey           :: SEC.SecKey
  } deriving Show

defaultOptions :: Options
defaultOptions = Options
  { optIssuerCert  = Nothing
  , optSubjectInfo = throw $ userError "Give me a subject JSON file"
  , optKey         = throw $ userError "Give me a private key PEM file"
  }

options :: [OptDescr (Options -> IO Options)]
options = 
  [Option ['i'] ["issuer"]
      (OptArg
       (\mIs opts -> case mIs of 
           Nothing -> return opts
           Just is -> do
             certBS <- B.readFile is
             case bsToCert certBS of
               Left err -> error $ "error reading issuer cert: " ++ err
               Right crt -> return opts{optIssuerCert = Just crt}
       ) "SignedCertificate")
   "The .pem filepath of the issuer's X.509 certificate. If not provided, this will be a self-signed cert"
  , Option ['s'] ["subject"]
      (ReqArg
       (\s opts -> do
          subStr <- readFile s
          let eSub = Ae.eitherDecodeStrict (C8.pack subStr) :: Either String Subject
              !sub = fromRight (error "invalid subject JSON") eSub
          return opts{optSubjectInfo = sub}
       ) "Subject")
    "The .json filepath of the subject information. Must be a valid JSON object with \
    \ commonName, country, organization, organizationUnit, and pubKey fields"
  , Option ['k'] ["key"]
      (ReqArg
       (\k opts -> do
          pkeyBS <- B.readFile k
          let pkey = bsToPriv pkeyBS
          return opts{optKey = pkey}
       ) "SecKey")
    "The .pem filepath of the private key with which to sign the certificate"
  ]

helpMessage :: String
helpMessage = usageInfo header options
  where header = "Usage: " ++ "x509-tool" ++ " [OPTION...]"


parseArgs :: IO Options
parseArgs = do
  argv <- getArgs
  case getOpt RequireOrder options argv of
    ([], _, errs) -> ioError (userError (concat errs ++ helpMessage))
    (opts, _, _) -> foldlM (flip id) defaultOptions opts



main :: IO ()
main = do 
  Options{..} <- parseArgs

--------------------------------------------------------------------------------------------
-------------------------------------- GENERATE CERT ---------------------------------------
--------------------------------------------------------------------------------------------

  let issuer = case optIssuerCert of
        Nothing -> Issuer
          { issCommonName = subCommonName optSubjectInfo
          , issCountry    = subCountry optSubjectInfo
          , issOrg        = subOrg optSubjectInfo
          , issUnit       = subUnit optSubjectInfo
          , issPriv       = optKey
          }
        Just (X509Certificate cert) -> do 
          let rawIssuerCert = getCertificate cert
              dn = certIssuerDN rawIssuerCert
              getStr el = fromASN1CS $ fromMaybe (error "could not getDnElement") $ getDnElement el dn
          Issuer 
            { issCommonName = getStr DnCommonName 
            , issCountry    = getStr DnCountry
            , issOrg        = getStr DnOrganization
            , issUnit       = getStr DnOrganizationUnit
            , issPriv       = optKey
            }

  -- generate and write cert
  cert <- makeSignedCert issuer optSubjectInfo
  B.writeFile "outputCert.pem" $ certToBytes $ cert
