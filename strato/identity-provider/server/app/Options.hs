{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options
  ( flags_port,
    flags_vaultProxyUrl,
    flags_SENDGRID_APIKEY,
    flags_userRegistryAddress,
  )
where

import HFlags

defineFlag "port" (8014 :: Int) "Port to run identity server on"
defineFlag "vaultProxyUrl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"
defineFlag "SENDGRID_APIKEY" ("" :: String) "The api key for sendgrid to automatically send the welcome email"
defineFlag "userRegistryAddress" ("4be508b4b59039cbacf5f18ccd9b67ab48e86e6d" :: String) "Address of the User Registry contract"
