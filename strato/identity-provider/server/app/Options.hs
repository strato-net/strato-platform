{-# LANGUAGE TemplateHaskell #-}
module Options 
    ( flags_port
    , flags_vaultProxyUrl
    , flags_nodeUrl
    , flags_OAUTH_CLIENT_ID
    , flags_OAUTH_CLIENT_SECRET
    , flags_OAUTH_MASTER_CLIENT_ID
    , flags_OAUTH_MASTER_CLIENT_SECRET
    , flags_OAUTH_DISCOVERY_URL
    ) where 

import HFlags

defineFlag "port" (8014 :: Int) "Port to run identity server on"
defineFlag "vaultProxyUrl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"
defineFlag "nodeUrl" ("http://localhost" :: String) "URL of the Strato Node to register the cert on"
defineFlag "OAUTH_DISCOVERY_URL" ("" :: String) "OAuth discovery URL"
defineFlag "OAUTH_CLIENT_ID" ("" :: String) "OAuth client ID"
defineFlag "OAUTH_CLIENT_SECRET" ("" :: String) "OAuth client secret"
defineFlag "OAUTH_MASTER_CLIENT_ID" ("" :: String) "OAuth client ID for master realm"
defineFlag "OAUTH_MASTER_CLIENT_SECRET" ("" :: String) "OAuth client secret for master realm"
