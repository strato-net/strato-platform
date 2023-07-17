{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
-- {-# LANGUAGE ScopedTypeVariables #-}

module Main (main) where

import           BlockApps.X509
import qualified Data.ByteString as B
import           HFlags
-- import           Network.HTTP.Client                    (newManager, defaultManagerSettings)
import           Network.Wai.Handler.Warp (run)
import           Lib
import           Options

main :: IO ()
main = do
    _ <- $initHFlags "Identity Server"
    if null flags_masterClientId || null flags_masterClientSecret
    then error "You must provide both a client id and secret of the master realm for a functioning identity server"
    else do 
        putStrLn "parsing issuer cert and private key..."
        certBS <- B.readFile flags_issuerCertPath
        crt <- case bsToCert certBS of
            Left err -> error $ "Error parsing issuer cert: " <> err
            Right crt -> do 
                putStrLn $ "Succuessfully parsed issuer cert: " ++ show crt
                return crt
        iss <- case getCertIssuer crt of
            Nothing -> error "Could not deduce issuer from provided cert. Perhaps it is malformed?"
            Just iss -> return iss
        privBS <- B.readFile flags_issuerPrivKeyPath
        privk <- case bsToPriv privBS of
            Left err -> error $ "Error parsing issuer private key: " <> err
            Right privk -> return privk

        putStrLn "Initializing identity server..."
        run flags_port $ identityProviderApp flags_nodeUrl flags_vaultProxyUrl iss crt privk flags_masterClientId flags_masterClientSecret flags_realmName
