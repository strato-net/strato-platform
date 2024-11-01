{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options
  ( flags_port,
    flags_vaultProxyUrl,
    flags_sendgridApiKey,
    flags_cacheSize,
    flags_nodeUrl,
    flags_fallbackNodeUrl,
    flags_userRegistryAddress,
    flags_userRegistryCodeHash,
    flags_userContractName,
    flags_oauthDiscoveryUrl,
    flags_oauthClientId,
    flags_oauthClientSecret,
    flags_notificationServerUrl
  )
where

import HFlags

defineFlag "port" (8014 :: Int) "Port to run identity server on"
defineFlag "vaultProxyUrl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"
defineFlag "sendgridApiKey" ("" :: String) "The api key for sendgrid to automatically send the welcome email"
defineFlag "cacheSize" (200 :: Int) "default size for each network's cache"
defineFlag "nodeUrl" ("http://localhost" :: String) "URL to STRATO node"
defineFlag "fallbackNodeUrl" ("" :: String) "URL to fallback STRATO node (Optional)"
defineFlag "userRegistryAddress" ("" :: String) "UserRegistry contract address"
defineFlag "userRegistryCodeHash" ("" :: String) "UserRegistry contract code collection hash"
defineFlag "userContractName" ("BlockApps-UserRegistry-User" :: String) "Name of on-chain wallet contract"
defineFlag "oauthDiscoveryUrl" ("" :: String) "URL to STRATO node"
defineFlag "oauthClientId" ("" :: String) "URL to STRATO node"
defineFlag "oauthClientSecret" ("" :: String) "URL to STRATO node"
defineFlag "notificationServerUrl" ("" :: String) "URL to notification server (Optional)"