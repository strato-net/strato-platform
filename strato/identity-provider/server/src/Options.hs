{-# LANGUAGE TemplateHaskell #-}
module Options 
    ( flags_vaultProxyUrl
    , flags_nodeUrl
    , flags_realmName
    , flags_masterClientId
    , flags_masterClientSecret
    , flags_issuerCertPath
    , flags_issuerPrivKeyPath
    ) where 

import HFlags

defineFlag "vaultProxyUrl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"
defineFlag "nodeUrl" ("http://localhost" :: String) "URL of the Strato Node to register the cert on"
defineFlag "realmName" ("" :: String) "OAuth realm name"
defineFlag "masterClientId" ("" :: String) "client id for Keycloak master realm to be able to query user information"
defineFlag "masterClientSecret" ("" :: String) "client secret for Keycloak master realm to be able to query user information"
defineFlag "issuerCertPath" ("./rootCert.pem" :: String) "The .pem filepath to the issuer's X509 cert"
defineFlag "issuerPrivKeyPath" ("./rootPriv.pem" :: String) "The .pem filepath to the issuer's private key for signing new certs"