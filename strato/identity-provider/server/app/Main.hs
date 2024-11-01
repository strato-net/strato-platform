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
import qualified Data.ByteString.Char8 as C8
import Data.Cache.LRU
import Data.IORef
import Data.Maybe (fromMaybe)
import Data.Time.Clock (getCurrentTime)
import HFlags
import IdentityProvider.Email (SendgridAPIKey (..))
import IdentityProvider.OAuth
import IdentityProvider.Server
import IdentityProvider.Server.Types
import Network.Wai.Handler.Warp (run)
import Servant.Client (parseBaseUrl)
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

  nurl <- parseBaseUrl flags_nodeUrl
  mNurl2 <- case flags_fallbackNodeUrl of 
    "" -> return Nothing
    url -> Just <$> parseBaseUrl url

  te <- token_endpoint <$> getEndpointsFromDiscovery flags_oauthDiscoveryUrl

  cRef <- newIORef $ newLRU (Just $ toInteger flags_cacheSize)
  now <- getCurrentTime
  tRef <- newIORef (Nothing, now)

  putStrLn "Initializing identity server..."
  let p = flags_port
      vp = flags_vaultProxyUrl
      ura = fromMaybe (Address 0x720) . stringAddress $ flags_userRegistryAddress
      murch = stringKeccak256 $ flags_userRegistryCodeHash
      mNotifUrl =
        if null flags_notificationServerUrl
          then Nothing
          else Just flags_notificationServerUrl
      mEmailK =
        if null flags_sendgridApiKey
          then Nothing
          else Just (SendgridAPIKey (C8.pack flags_sendgridApiKey))
  run p $ identityProviderApp vp $ 
    IdentityServerData 
      iss 
      crt 
      privk 
      nurl
      mNurl2
      ura
      murch
      flags_userContractName
      te
      flags_oauthClientId
      flags_oauthClientSecret
      tRef
      cRef
      mNotifUrl
      mEmailK
