{-# LANGUAGE TemplateHaskell #-}
module Options (flags_vaultproxyurl) where 

import HFlags

defineFlag "vaultproxyurl" ("http://localhost:8013/strato/v2.3" :: String) "URL to Vault"