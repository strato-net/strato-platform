{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module Options
  ( flags_port,
    flags_nodeUrl,
    flags_userRegistryAddress,
    flags_userRegistryCodeHash,
    flags_userContractName,
    flags_CLIENT_ID,
    flags_CLIENT_SECRET,
    flags_OAUTH_DISCOVERY_URL
  )
where

import HFlags

defineFlag "port" (8014 :: Int) "Port to run identity server on"
defineFlag "nodeUrl" ("http://localhost" :: String) "URL to STRATO node"
defineFlag "OAUTH_DISCOVERY_URL" ("" :: String) "URL to STRATO node" --consistency in casing???
defineFlag "CLIENT_ID" ("" :: String) "URL to STRATO node"
defineFlag "CLIENT_SECRET" ("" :: String) "URL to STRATO node"
defineFlag "userRegistryAddress" ("" :: String) "UserRegistry contract address"
defineFlag "userRegistryCodeHash" ("92a723ccc17f51f4de1ce7e51792fed70d59e50f0bf58579df25fd343120d745" :: String) "UserRegistry contract code collection hash"
defineFlag "userContractName" ("BlockApps-UserRegistry-User" :: String) "Name of on-chain wallet contract"