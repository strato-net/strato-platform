{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
-- {-# LANGUAGE ScopedTypeVariables #-}

module Main (main) where

-- import           BlockApps.Logging
-- import           Control.Monad.IO.Class
import           BlockApps.X509
import           Data.ByteString as B
import           HFlags
-- import           Network.HTTP.Client                    (newManager, defaultManagerSettings)
import           Network.Wai.Handler.Warp (run)
import           Lib
import           Options

-- type IDServerM m = (MonadLogger m, MonadIO m, MonadReader IDServerVaultConn m )--  ReaderT IDServerVaultConn (LoggingT IO)
main :: IO ()
main = do
    _ <- $initHFlags "Identity Server"
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
    run 8081 $ identityProviderApp flags_nodeUrl flags_vaultProxyUrl iss crt privk
