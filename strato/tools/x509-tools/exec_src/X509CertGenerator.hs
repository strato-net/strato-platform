{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-orphans      #-}

import BlockApps.X509
import Blockchain.Strato.Model.Secp256k1
import Control.Exception
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import qualified Data.Aeson as Ae
import qualified Data.ByteString as B
import Data.Either
import Data.Foldable (foldlM)
import Data.Hourglass
import Data.Maybe
import System.Console.GetOpt
import System.Environment

-- a simple ReaderT to keep the private key
type CertGenM = ReaderT PrivateKey IO

instance HasVault CertGenM where
  getPub = error "we never call getPub with this tool"
  getShared _ = error "we never call getShared with this tool"
  sign bs = ask >>= return . flip signMsg bs

--------------------------------------------------------------------------------------------
----------------------------------------- ARGS ---------------------------------------------
--------------------------------------------------------------------------------------------

data Options = Options
  { optIssuerCert :: Maybe X509Certificate,
    optSubjectInfo :: Subject,
    optKey :: PrivateKey,
    optOutputName :: String,
    optDateTime :: Maybe DateTime
  }
  deriving (Show)

defaultOptions :: Options
defaultOptions =
  Options
    { optIssuerCert = Nothing,
      optSubjectInfo = throw $ userError "Give me a subject JSON file",
      optKey = throw $ userError "Give me a private key PEM file",
      optOutputName = "OutputCert.pem",
      optDateTime = Nothing
    }

options :: [OptDescr (Options -> IO Options)]
options =
  [ Option
      ['i']
      ["issuer"]
      ( OptArg
          ( \mIs opts -> case mIs of
              Nothing -> return opts
              Just is -> do
                certBS <- B.readFile is
                case bsToCert certBS of
                  Left err -> error $ "error reading issuer cert: " ++ err
                  Right crt -> return opts {optIssuerCert = Just crt}
          )
          "SignedCertificate"
      )
      "The .pem filepath of the issuer's X.509 certificate. If not provided, this will be a self-signed cert",
    Option
      ['s']
      ["subject"]
      ( ReqArg
          ( \s opts -> do
              subStr <- B.readFile s
              let eSub = Ae.eitherDecodeStrict subStr :: Either String Subject
                  !sub = fromRight (error "invalid subject JSON") eSub
              return opts {optSubjectInfo = sub}
          )
          "Subject"
      )
      "The .json filepath of the subject information. Must be a valid JSON object with \
      \ commonName, country, organization, organizationUnit, and pubKey fields",
    Option
      ['k']
      ["key"]
      ( ReqArg
          ( \k opts -> do
              pkeyBS <- B.readFile k
              let ePkey = bsToPriv pkeyBS
              case ePkey of
                Left err -> error err
                Right pkey -> return opts {optKey = pkey}
          )
          "SecKey"
      )
      "The .pem filepath of the private key with which to sign the certificate",
    Option
      ['d']
      ["date"]
      ( OptArg
          ( \mDate opts -> case mDate of
              Nothing -> return opts
              Just d -> do
                let date = fromMaybe (error "Date didn't parse! Need e.g. 2014-04-05 ") (timeParse ISO8601_Date d)
                return opts {optDateTime = Just date}
          )
          "dateTime"
      )
      "The certificate expiration date",
    Option
      ['o']
      ["output"]
      ( OptArg
          ( \mOut opts -> case mOut of
              Nothing -> return opts
              Just fileName -> return opts {optOutputName = fileName}
          )
          "OutputName"
      )
      "The .pem filepath to write the created cert to. If not provided, this will be written to ./outputCert.pem"
  ]

helpMessage :: String
helpMessage = usageInfo header options
  where
    header = "Usage: " ++ "x509-tool" ++ " [OPTION...]"

parseArgs :: IO Options
parseArgs = do
  argv <- getArgs
  case getOpt RequireOrder options argv of
    ([], _, errs) -> ioError (userError (concat errs ++ helpMessage))
    (opts, _, _) -> foldlM (flip id) defaultOptions opts

main :: IO ()
main = do
  Options {..} <- parseArgs

  --------------------------------------------------------------------------------------------
  -------------------------------------- GENERATE CERT ---------------------------------------
  --------------------------------------------------------------------------------------------

  let issuer = case (optIssuerCert, getCertSubject =<< optIssuerCert) of
        (Nothing, _) ->
          Issuer
            { issCommonName = subCommonName optSubjectInfo,
              issCountry = subCountry optSubjectInfo,
              issOrg = subOrg optSubjectInfo,
              issUnit = subUnit optSubjectInfo
            }
        (Just _, Just (Subject {..})) ->
          Issuer
            { issCommonName = subCommonName,
              issCountry = subCountry,
              issOrg = subOrg,
              issUnit = subUnit
            }
        _ -> error "missing commonName or orgName in issuer cert"

  -- generate and write cert
  flip runReaderT optKey $ do
    cert <- makeSignedCert optDateTime optIssuerCert issuer optSubjectInfo
    liftIO $ B.writeFile optOutputName $ certToBytes $ cert
    liftIO $ putStrLn $ "Done. Cert was written to " ++ optOutputName
