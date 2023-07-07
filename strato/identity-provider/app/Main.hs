-- {-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
-- {-# LANGUAGE ScopedTypeVariables #-}

module Main (main) where

import           Network.Wai.Handler.Warp (run)
import           Lib
-- import           BlockApps.Logging

main :: IO ()
main = do
    -- $logInfoS "Identity Server Setup" "Initializing identity server..."
    putStrLn "Getting master token"
    mToken <- getAccessToken
    print mToken
    eUser <- case mToken of 
        Just token -> do
            putStrLn "now for the user"
            getUserByUUID token "fdc2a8c1-a598-415d-b854-25c0236dcf31"
        Nothing -> return $ Left "no token"
    print eUser
    putStrLn "Initializing identity server..."
    run 8081 identityProviderApp

