{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Handlers.Options
(
    flags_vaultUrl,
    flags_oauthDiscoveryUrl,
    flags_fileServerUrl,
    flags_notificationServerUrl
)
where

import HFlags

defineFlag "vaultUrl" ("" :: String) "Url to vault"
defineFlag "oauthDiscoveryUrl" ("" :: String) "Url to OAuth realm's discovery endpoint"
defineFlag "fileServerUrl" ("" :: String) "Url to file server for marketplace"
defineFlag "notificationServerUrl" ("" :: String) "Url to notification server for marketplace"

