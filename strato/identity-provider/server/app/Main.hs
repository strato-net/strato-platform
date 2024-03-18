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
import IdentityProvider.Email (SendgridAPIKey (..))
import IdentityProvider.OAuth
import IdentityProvider.Server
import Network.Wai.Handler.Warp (run)
import Options

-- Import the --minLogLevel flag

main :: IO ()
main = do
  putStrLn "************ STARTING UP IDENTITY SERVER ************"
  _ <- $initHFlags "Identity Server"
  putStrLn "parsing issuer cert and private key..."
  certBS <- B.readFile "/identity-provider/certs/rootCert.pem"
  crt <- case bsToCert certBS of
    Left err -> error $ "Error parsing issuer cert: " <> err
    Right crt -> do
      putStrLn "Succuessfully parsed issuer cert"
      return crt
  iss <- case getCertIssuer crt of
    Nothing -> error "Could not deduce issuer from provided cert. Perhaps it is malformed?"
    Just iss -> return iss
  privBS <- B.readFile "/identity-provider/certs/rootPriv.pem"
  privk <- case bsToPriv privBS of
    Left err -> error $ "Error parsing issuer private key: " <> err
    Right privk -> return privk

  -- read and parse idconf.yaml
  yamlContents <- B.readFile "/identity-provider/idconf.yaml"
  let idconf :: [ProvidedRealmInfo] = either (error . show) id (decodeEither' yamlContents)
  realmData <- getRealmMap idconf flags_cacheSize
  if Map.null realmData
    then error "Oh no! We have no realm data. How can we operate on this little info?"
    else putStrLn "Successfully parsed realm data from yaml file"

  putStrLn "Initializing identity server..."
  let p = flags_port
      vp = flags_vaultProxyUrl
      mEmailK =
        if null flags_SENDGRID_APIKEY
          then Nothing
          else Just (SendgridAPIKey (C8.pack flags_SENDGRID_APIKEY))
  run p $ identityProviderApp vp iss crt privk realmData mEmailK
