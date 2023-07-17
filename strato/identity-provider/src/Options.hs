{-# LANGUAGE TemplateHaskell #-}
module Options 
    ( flags_vaultProxyUrl
    , flags_nodeUrl
    , flags_issuerCertPath
    , flags_issuerPrivKeyPath
    ) where 

import HFlags

defineFlag "vaultProxyUrl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"
defineFlag "nodeUrl" ("http://localhost" :: String) "URL of the Strato Node to register the cert on"
defineFlag "issuerCertPath" ("./rootCert.pem" :: String) "The .pem filepath to the issuer's X509 cert"
defineFlag "issuerPrivKeyPath" ("./rootPriv.pem" :: String) "The .pem filepath to the issuer's private key for signing new certs"