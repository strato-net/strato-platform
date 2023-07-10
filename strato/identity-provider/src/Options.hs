{-# LANGUAGE TemplateHaskell #-}
module Options (flags_vaulturl) where 

import HFlags

defineFlag "vaulturl" ("http://localhost:8088" :: String) "URL to Vault"