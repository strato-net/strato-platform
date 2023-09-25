{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-orphans      #-}

import BlockApps.X509
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import Data.Foldable (foldlM)
import System.Console.GetOpt
import System.Environment

--------------------------------------------------------------------------------------------
----------------------------------------- ARGS ---------------------------------------------
--------------------------------------------------------------------------------------------

data AsserterOptions = AsserterOptions
  { optCert :: Maybe X509Certificate
  }
  deriving (Show)

defaultOptionsAssert :: AsserterOptions
defaultOptionsAssert =
  AsserterOptions
    { optCert = Nothing
    }

options :: [OptDescr (AsserterOptions -> IO AsserterOptions)]
options =
  [ Option
      ['c']
      ["cert"]
      ( ReqArg
          ( \certPath opts -> do
              certBS <- B.readFile certPath
              case bsToCert certBS of
                Left err -> error $ "error reading issuer cert: " ++ err
                Right crt -> return opts {optCert = Just crt}
          )
          "SignedCertificate"
      )
      "The .pem filepath of the X.509 certificate."
  ]

helpMessageAssert :: String
helpMessageAssert = usageInfo header options
  where
    header = "Usage: " ++ "x509-info-tool" ++ " [OPTION...]"

parseArgsAssert :: IO AsserterOptions
parseArgsAssert = do
  argv <- getArgs
  case getOpt RequireOrder options argv of
    ([], _, errs) -> ioError (userError (concat errs ++ helpMessageAssert))
    (opts, _, _) -> foldlM (flip id) defaultOptionsAssert opts

{--
This is an executable that gives you the information about a certificate and if it was signed by the blockapps key
--}

main :: IO ()
main = do
  AsserterOptions {..} <- parseArgsAssert

  --------------------------------------------------------------------------------------------
  -------------------------------------- CERT INFO -------------------------------------------
  --------------------------------------------------------------------------------------------

  case optCert of
    Nothing -> error "No Cert file path given"
    Just cert -> do
      isValid <- verifyCertM rootPubKey cert
      if isValid
        then do
          liftIO $ putStrLn "TRUE. This cert was signed by BlockApps"
        else do
          liftIO $ putStrLn "FALSE. This cert was not signed by BlockApps"
