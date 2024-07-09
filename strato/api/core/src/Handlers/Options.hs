{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Handlers.Options
(
    flags_vaultUrl,
    flags_oauthDiscoveryUrl,
    flags_fileServerUrl
)
where

import HFlags

defineFlag "vaultUrl" ("" :: String) "Url to vault"
defineFlag "oauthDiscoveryUrl" ("" :: String) "Url to OAuth realm's discovery endpoint"
defineFlag "fileServerUrl" ("" :: String) "Url to file server for marketplace"

