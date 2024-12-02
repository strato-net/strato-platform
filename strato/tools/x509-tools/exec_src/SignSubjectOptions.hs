{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module SignSubjectOptions where

import HFlags

defineFlag "v:vault_proxy" ("http://strato:8013/strato/v2.3" :: String) "The url to vault proxy (default assumes being run within strato docker network)"
defineFlag "r:verification_key" ("" :: String) "The PEM file which holds the already-registered private key used for identity verification"
defineFlag "o:organization" ("" :: String) "The desired subject's organization (optional)"
defineFlag "u:organizationUnit" ("" :: String) "The desired subject's organization unit (optional)"
defineFlag "n:commonName" ("" :: String) "The desired subject's common name"
defineFlag "c:country" ("" :: String) "The desired subject's country"
defineFlag "p:public_key" ("" :: String) "The desired subject's public key (if blank, public key is derived from --key)"
defineFlag "s:ssl_cert_file" ("" :: String) "The name of the SSL cert pointing to the subject's domain name"
