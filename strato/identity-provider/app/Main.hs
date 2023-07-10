{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
-- {-# LANGUAGE ScopedTypeVariables #-}

module Main (main) where

-- import           BlockApps.Logging
-- import           Control.Monad.IO.Class
import           HFlags
-- import           Network.HTTP.Client                    (newManager, defaultManagerSettings)
import           Network.Wai.Handler.Warp (run)
import           Lib
-- import           Options (flags_vaulturl)
-- import           Servant.Client

-- newtype IDServerVaultConn = IDServerVaultConn {vaultConn :: ClientEnv}
-- type IDServerM m = (MonadLogger m, MonadIO m, MonadReader IDServerVaultConn m )--  ReaderT IDServerVaultConn (LoggingT IO)
main :: IO ()
main = do
    _ <- $initHFlags "Identity Server"

    -- set up vault client connection
    -- mgr <- newManager defaultManagerSettings
    -- url <- parseBaseUrl flags_vaulturl
    -- let vaultClient = mkClientEnv mgr url
    
    
    -- putStrLn "Getting master token"
    -- mToken <- getAccessToken
    -- print mToken
    -- eUser <- case mToken of 
    --     Just token -> do
    --         putStrLn "now for the user"
    --         getUserByUUID token "fdc2a8c1-a598-415d-b854-25c0236dcf31"
    --     Nothing -> return $ Left "no token"
    -- print eUser
    putStrLn "Initializing identity server..."
    run 8081 identityProviderApp
