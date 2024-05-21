{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Main (main) where

import BlockApps.Logging ()
import BlockApps.X509
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import qualified Data.Map as Map (null)
import Data.Yaml
import HFlags
import IdentityService.Email (SendgridAPIKey (..))
import IdentityService.Server
import Network.Wai.Handler.Warp (run)
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

  putStrLn "Initializing identity server..."
  let p = flags_port
      vp = flags_vaultProxyUrl
      mEmailK =
        if null flags_SENDGRID_APIKEY
          then Nothing
          else Just (SendgridAPIKey (C8.pack flags_SENDGRID_APIKEY))
      idData = IdentityServerData
      { nodeUrl = nurl,
        userRegAddr = fromMaybe (Address 0x720) $ userRegistryAddress realmInfo,
        userRegCodeHash = userRegistryCodeHash realmInfo,
        userTableName = fromMaybe "User" $ userTableName realmInfo,
        cacheRef = cRef,
        accessTokenRef = tRef
      }
  run p $ identityServiceApp vp idData
