-- {-# LANGUAGE TemplateHaskell #-}
-- {-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import           Network.Wai.Handler.Warp (run)
import           Lib                      (identityProviderApp)
-- import           BlockApps.Logging

main :: IO ()
main = do
    -- $logInfoS "Identity Server Setup" "Initializing identity server..."
    putStrLn "Initializing identity server..."
    run 8081 identityProviderApp
