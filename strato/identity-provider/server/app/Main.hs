{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
-- {-# LANGUAGE ScopedTypeVariables #-}

module Main (main) where

import           BlockApps.X509
import qualified Data.ByteString as B
import           Network.Wai.Handler.Warp (run)
import           IdentityProvider.Server
import           HFlags
import           Options
import           BlockApps.Logging () -- Import the --minLogLevel flag

main :: IO ()
main = do
    putStrLn "************ STARTING UP IDENTITY SERVER ************"
    _ <- $initHFlags "Identity Server"
    if     null flags_OAUTH_MASTER_CLIENT_ID 
        || null flags_OAUTH_MASTER_CLIENT_SECRET
        || null flags_OAUTH_CLIENT_ID
        || null flags_OAUTH_CLIENT_SECRET
    then error "You must provide client ids and secrets for both the current realm and master realm to have a functioning identity server"
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
        let p = flags_port 
            n = flags_nodeUrl
            vp = flags_vaultProxyUrl
            cid = flags_OAUTH_CLIENT_ID
            cs = flags_OAUTH_CLIENT_SECRET
            mid = flags_OAUTH_MASTER_CLIENT_ID
            ms = flags_OAUTH_MASTER_CLIENT_SECRET
            rn = flags_realmName
        run p $ identityProviderApp n vp iss crt privk cid cs mid ms rn
