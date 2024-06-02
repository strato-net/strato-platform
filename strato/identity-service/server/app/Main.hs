{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Main (main) where

import BlockApps.Logging ()
import BlockApps.X509
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import qualified Data.ByteString as B
import Data.Maybe (fromMaybe)
import HFlags
import IdentityService.Server
import Network.Wai.Handler.Warp (run)
import Servant.Client
import Options

-- Import the --minLogLevel flag

main :: IO ()
main = do
  putStrLn "************ STARTING UP IDENTITY SERVER ************"
  _ <- $initHFlags "Identity Server"
  putStrLn "parsing issuer cert and private key..."
  certBS <- B.readFile "/identity-service/certs/rootCert.pem"
  crt <- case bsToCert certBS of
    Left err -> error $ "Error parsing issuer cert: " <> err
    Right crt -> do
      putStrLn "Succuessfully parsed issuer cert"
      return crt
  iss <- case getCertIssuer crt of
    Nothing -> error "Could not deduce issuer from provided cert. Perhaps it is malformed?"
    Just iss -> return iss
  privBS <- B.readFile "/identity-service/certs/rootPriv.pem"
  privk <- case bsToPriv privBS of
    Left err -> error $ "Error parsing issuer private key: " <> err
    Right privk -> return privk
  nurl <- parseBaseUrl flags_nodeUrl

  putStrLn "Initializing identity server..."
  let p = flags_port
      idData = IdentityServerData
                 { issuer = iss,
                   issuerCert = crt,
                   issuerPrivKey = privk,
                   nodeUrl = nurl,
                   userRegAddr = fromMaybe (Address 0x720) . stringAddress $ flags_userRegistryAddress,
                   userRegCodeHash = stringKeccak256 $ flags_userRegistryCodeHash,
                   userTableName = flags_userContractName
                 }
  run p $ identityServiceApp idData
