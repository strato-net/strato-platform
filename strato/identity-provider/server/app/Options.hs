{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options
    ( flags_port
    , flags_vaultProxyUrl
    , flags_nodeUrl
    ) where

import HFlags

defineFlag "port" (8014 :: Int) "Port to run identity server on"
defineFlag "vaultProxyUrl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"
defineFlag "nodeUrl" ("http://localhost" :: String) "URL of the Strato Node to register the cert on"