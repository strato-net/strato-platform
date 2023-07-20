{-# LANGUAGE TemplateHaskell #-}
module Options 
    ( flags_port
    , flags_vaultProxyUrl
    , flags_nodeUrl
    , flags_realmName
    , flags_issuerCertPath
    , flags_issuerPrivKeyPath
    , flags_OAUTH_PROVIDER_URL
    , flags_OAUTH_TOKEN_ENDPOINT
    , flags_OAUTH_USER_ENDPOINT
    , flags_OAUTH_CLIENT_ID
    , flags_OAUTH_CLIENT_SECRET
    , flags_OAUTH_MASTER_CLIENT_ID
    , flags_OAUTH_MASTER_CLIENT_SECRET
    ) where 

import HFlags

defineFlag "port" (8081 :: Int) "Port to run ientity server on"
defineFlag "vaultProxyUrl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"
defineFlag "nodeUrl" ("http://localhost" :: String) "URL of the Strato Node to register the cert on"
defineFlag "realmName" ("" :: String) "OAuth realm name"
defineFlag "issuerCertPath" ("/identity-provider/rootCert.pem" :: String) "The .pem filepath to the issuer's X509 cert"
defineFlag "issuerPrivKeyPath" ("/identity-provider/rootPriv.pem" :: String) "The .pem filepath to the issuer's private key for signing new certs"
defineFlag "OAUTH_PROVIDER_URL" ("http://localhost:8080" :: String) "OAuth provider URL"
defineFlag "OAUTH_TOKEN_ENDPOINT" ("/realms/master/protocol/openid-connect/token" :: String) "Endpoint for retrieving token from OAuth provider"
defineFlag "OAUTH_USER_ENDPOINT" ("/admin/realms/myrealm/users" :: String) "Endpoint for retrieving token from OAuth provider"
defineFlag "OAUTH_DISCOVERY_URL" ("" :: String) "OAuth discovery URL"
defineFlag "OAUTH_CLIENT_ID" ("" :: String) "OAuth client ID"
defineFlag "OAUTH_CLIENT_SECRET" ("" :: String) "OAuth client secret"
defineFlag "OAUTH_MASTER_CLIENT_ID" ("admin" :: String) "OAuth client ID for master realm"
defineFlag "OAUTH_MASTER_CLIENT_SECRET" ("admin" :: String) "OAuth client secret for master realm"
