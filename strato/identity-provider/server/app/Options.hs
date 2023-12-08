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
defineFlag "userRegistryAddress" ("4ff4fd7c213761718a86d4a2cb3cc334e3f60f31" :: String) "Address of the User Registry contract"
