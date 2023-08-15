{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ConstraintKinds     #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Main (main) where

import           BlockApps.X509
import qualified Data.ByteString as B
import qualified Data.Map as Map (null)
import           Data.Yaml

import           Network.Wai.Handler.Warp (run)
import           IdentityProvider.Server
import           IdentityProvider.OAuth

import           HFlags
import           Options
import           BlockApps.Logging () -- Import the --minLogLevel flag

main :: IO ()
main = do
    putStrLn "************ STARTING UP IDENTITY SERVER ************"
    _ <- $initHFlags "Identity Server"
    putStrLn "parsing issuer cert and private key..."
    certBS <- B.readFile "/identity-provider/certs/rootCert.pem"
    crt <- case bsToCert certBS of
        Left err -> error $ "Error parsing issuer cert: " <> err
        Right crt -> do 
            putStrLn $ "Succuessfully parsed issuer cert: " ++ show crt
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
    let idconf :: [RealmMinInfo] = either (error . show) id (decodeEither' yamlContents)
    realmData <- getRealmData idconf
    if Map.null realmData
        then error "Oh no! We have no realm data. How can we operate on this little info?"
        else putStrLn "Successfully parsed realm data from yaml file"
    
    putStrLn "Initializing identity server..."
    let p = flags_port 
        vp = flags_vaultProxyUrl
    run p $ identityProviderApp vp iss crt privk realmData