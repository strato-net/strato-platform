{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options
  ( flags_port,
    flags_vaultProxyUrl,
    flags_SENDGRID_APIKEY,
    flags_cacheSize
  )
where

import HFlags

defineFlag "port" (8014 :: Int) "Port to run identity server on"
defineFlag "vaultProxyUrl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"
defineFlag "SENDGRID_APIKEY" ("" :: String) "The api key for sendgrid to automatically send the welcome email"
defineFlag "cacheSize" (200 :: Int) "default size for each network's cache"