{-# LANGUAGE TemplateHaskell #-}

module Executable.Options where

import           HFlags


defineFlag "vaultProxyUrl" ("http://strato:8013/vault-proxy" :: String) "Vault-proxy URL"

$(return [])
